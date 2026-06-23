import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';

type Kind = 'percentage' | 'fixed' | 'progressive' | 'garnishment';

interface Bracket {
  min: number;
  max: number | null;
  rate: number;
}

interface GarnishmentConfig {
  minimumSalary: number;
  protectedMultiplier: number;
  upperMultiplier: number;
  midRate: number;
  topRate: number;
}

interface GarnishmentRange {
  label: string;
  from: number;
  to: number | null;
  rate: number;
  base: number;   // portion of net falling in this band
  amount: number; // base * rate
}

const bracketSchema = z.object({
  min: z.coerce.number().min(0),
  max: z.coerce.number().positive().nullable(),
  rate: z.coerce.number().min(0).max(1),
});

const garnishmentConfigSchema = z.object({
  minimumSalary: z.coerce.number().positive(),
  protectedMultiplier: z.coerce.number().min(0).default(1),
  upperMultiplier: z.coerce.number().positive().default(4),
  midRate: z.coerce.number().min(0).max(1).default(0.125),
  topRate: z.coerce.number().min(0).max(1).default(0.25),
});

const baseFields = {
  name: z.string().trim().min(1).max(120),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
  affectsGarnishmentBase: z.boolean().optional(),
};

const createSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('percentage'), rate: z.coerce.number().min(0).max(1), ...baseFields }),
  z.object({ kind: z.literal('fixed'), amount: z.coerce.number().min(0), ...baseFields }),
  z.object({ kind: z.literal('progressive'), brackets: z.array(bracketSchema).min(1), ...baseFields }),
  z.object({ kind: z.literal('garnishment'), config: garnishmentConfigSchema, ...baseFields }),
]);

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
  affectsGarnishmentBase: z.boolean().optional(),
  rate: z.coerce.number().min(0).max(1).nullable().optional(),
  amount: z.coerce.number().min(0).nullable().optional(),
  brackets: z.array(bracketSchema).min(1).nullable().optional(),
  config: garnishmentConfigSchema.nullable().optional(),
});

const calculateSchema = z.object({
  gross: z.coerce.number().min(0),
  deductionIds: z.array(z.string().uuid()).optional(),
  overrides: z
    .record(z.string().uuid(), z.object({ amount: z.coerce.number().min(0).optional() }))
    .optional(),
});

interface DeductionRow {
  id: string;
  user_id: string;
  name: string;
  kind: Kind;
  rate: string | null;
  amount: string | null;
  brackets: Bracket[] | null;
  config: GarnishmentConfig | null;
  active: boolean;
  affects_garnishment_base: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mapRow(row: DeductionRow) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    rate: row.rate != null ? Number(row.rate) : null,
    amount: row.amount != null ? Number(row.amount) : null,
    brackets: row.brackets,
    config: row.config,
    active: row.active,
    affectsGarnishmentBase: row.affects_garnishment_base,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Marginal progressive tax. Only the slice of `gross` falling within each
 * bracket is taxed at that bracket's rate. `max: null` means "and up".
 *
 * Example (CR Renta-style brackets, gross = 2,884,000):
 *   0..918k        @ 0%   -> 0
 *   918k..1.347M   @ 10%  -> 42,900
 *   1.347M..2.364M @ 15%  -> 152,550
 *   2.364M..2.884M @ 20%  -> 104,000
 *   total = 299,450
 */
export function calcProgressive(gross: number, brackets: Bracket[]): number {
  if (gross <= 0 || !brackets.length) return 0;
  const sorted = [...brackets].sort((a, b) => a.min - b.min);
  let tax = 0;
  for (const b of sorted) {
    if (gross <= b.min) break;
    const ceiling = b.max == null ? gross : Math.min(gross, b.max);
    const slice = Math.max(0, ceiling - b.min);
    tax += slice * b.rate;
  }
  return tax;
}

/**
 * Costa Rica-style salary garnishment.
 *
 *   garnishment =
 *     MAX(0, MIN(net, min * upperMult) - min * protectedMult) * midRate
 *     +
 *     MAX(0, net - min * upperMult) * topRate
 *
 * Example: net=2,214,110  min=268,731.31  protected=1  upper=4  mid=12.5%  top=25%
 *   mid base = MIN(2214110, 1074925.24) - 268731.31 = 806193.93   -> 100,774.24
 *   top base = 2214110 - 1074925.24 = 1139184.76                  -> 284,796.19
 *   total = 385,570.43
 */
export function calcGarnishment(
  net: number,
  cfg: GarnishmentConfig,
): { total: number; ranges: GarnishmentRange[] } {
  const min = cfg.minimumSalary;
  const protectedCap = min * cfg.protectedMultiplier;
  const upperCap = min * cfg.upperMultiplier;

  const protectedBase = Math.max(0, Math.min(net, protectedCap));
  const midBase = Math.max(0, Math.min(net, upperCap) - protectedCap);
  const topBase = Math.max(0, net - upperCap);

  const midAmount = midBase * cfg.midRate;
  const topAmount = topBase * cfg.topRate;

  const ranges: GarnishmentRange[] = [
    { label: `0 to ${protectedCap.toFixed(2)} (protected)`, from: 0, to: protectedCap, rate: 0, base: protectedBase, amount: 0 },
    { label: `${protectedCap.toFixed(2)} to ${upperCap.toFixed(2)}`, from: protectedCap, to: upperCap, rate: cfg.midRate, base: midBase, amount: midAmount },
    { label: `${upperCap.toFixed(2)} and above`, from: upperCap, to: null, rate: cfg.topRate, base: topBase, amount: topAmount },
  ];

  return { total: midAmount + topAmount, ranges };
}

function nonGarnishmentAmount(
  gross: number,
  d: ReturnType<typeof mapRow>,
  overrideAmount?: number,
): number {
  if (overrideAmount !== undefined) return overrideAmount;
  switch (d.kind) {
    case 'percentage':
      return gross * (d.rate ?? 0);
    case 'fixed':
      return d.amount ?? 0;
    case 'progressive':
      return calcProgressive(gross, d.brackets ?? []);
    case 'garnishment':
      return 0; // handled in pass 2
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Default Costa Rica payroll deductions used by the "seed defaults" endpoint.
// Stored as decimals (0.0983 = 9.83%). `affectsGarnishmentBase` marks the
// statutory items (CCSS, Operadora de Pensiones, Renta) whose amounts reduce
// the salario líquido used as the judicial garnishment base.
const CR_DEFAULTS: Array<
  (
    | { name: string; kind: 'percentage'; rate: number }
    | { name: string; kind: 'fixed'; amount: number }
    | { name: string; kind: 'progressive'; brackets: Bracket[] }
    | { name: string; kind: 'garnishment'; config: GarnishmentConfig }
  ) & { affectsGarnishmentBase?: boolean }
> = [
  { name: 'Aporte Empl. CCSS', kind: 'percentage', rate: 0.0983, affectsGarnishmentBase: true },
  { name: 'Aporte Empl. Oper. Pen', kind: 'percentage', rate: 0.01, affectsGarnishmentBase: true },
  { name: 'Aporte ASEAKAMAI', kind: 'percentage', rate: 0.04 },
  { name: 'Plan Medico (NC)', kind: 'fixed', amount: 0 },
  { name: 'Embargo de Salario', kind: 'percentage', rate: 0.1391 },
  {
    name: 'Impuesto de Renta',
    kind: 'progressive',
    affectsGarnishmentBase: true,
    brackets: [
      { min: 0, max: 918000, rate: 0 },
      { min: 918000, max: 1347000, rate: 0.10 },
      { min: 1347000, max: 2364000, rate: 0.15 },
      { min: 2364000, max: 4727000, rate: 0.20 },
      { min: 4727000, max: null, rate: 0.25 },
    ],
  },
  {
    name: 'Embargo Judicial',
    kind: 'garnishment',
    config: {
      minimumSalary: 268731.31,
      protectedMultiplier: 1,
      upperMultiplier: 4,
      midRate: 0.125,
      topRate: 0.25,
    },
  },
];

export default async function payrollRoutes(app: FastifyInstance) {
  // List the user's deduction library.
  app.get('/payroll/deductions', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const result = await app.pg.query<DeductionRow>(
      `SELECT id, user_id, name, kind, rate, amount, brackets, config, active, affects_garnishment_base, sort_order, created_at, updated_at
         FROM payroll_deductions
        WHERE user_id = $1
        ORDER BY sort_order ASC, lower(name) ASC`,
      [userId],
    );
    return result.rows.map(mapRow);
  });

  app.post('/payroll/deductions', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const body = createSchema.parse(request.body);
    const rate = body.kind === 'percentage' ? body.rate : null;
    const amount = body.kind === 'fixed' ? body.amount : null;
    const brackets = body.kind === 'progressive' ? JSON.stringify(body.brackets) : null;
    const config = body.kind === 'garnishment' ? JSON.stringify(body.config) : null;
    const result = await app.pg.query<DeductionRow>(
      `INSERT INTO payroll_deductions (user_id, name, kind, rate, amount, brackets, config, active, affects_garnishment_base, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, COALESCE($8, true), COALESCE($9, false), COALESCE($10, 0))
       RETURNING id, user_id, name, kind, rate, amount, brackets, config, active, affects_garnishment_base, sort_order, created_at, updated_at`,
      [userId, body.name, body.kind, rate, amount, brackets, config, body.active ?? null, body.affectsGarnishmentBase ?? null, body.sortOrder ?? null],
    );
    reply.code(201);
    return mapRow(result.rows[0]);
  });

  app.put('/payroll/deductions/:id', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const id = (request.params as { id: string }).id;
    const body = updateSchema.parse(request.body);

    const existing = await app.pg.query<DeductionRow>(
      `SELECT id, user_id, name, kind, rate, amount, brackets, config, active, affects_garnishment_base, sort_order, created_at, updated_at
         FROM payroll_deductions WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (existing.rows.length === 0) throw new NotFoundError('Deduction not found');
    const cur = existing.rows[0];

    // Enforce kind/field consistency: a percentage deduction must keep its rate, etc.
    let newRate: number | null = cur.rate != null ? Number(cur.rate) : null;
    let newAmount: number | null = cur.amount != null ? Number(cur.amount) : null;
    let newBrackets: Bracket[] | null = cur.brackets;
    let newConfig: GarnishmentConfig | null = cur.config;
    if (cur.kind === 'percentage' && body.rate !== undefined) {
      if (body.rate == null) throw new BadRequestError('rate required for percentage deduction');
      newRate = body.rate;
    } else if (cur.kind === 'fixed' && body.amount !== undefined) {
      if (body.amount == null) throw new BadRequestError('amount required for fixed deduction');
      newAmount = body.amount;
    } else if (cur.kind === 'progressive' && body.brackets !== undefined) {
      if (body.brackets == null) throw new BadRequestError('brackets required for progressive deduction');
      newBrackets = body.brackets;
    } else if (cur.kind === 'garnishment' && body.config !== undefined) {
      if (body.config == null) throw new BadRequestError('config required for garnishment deduction');
      newConfig = body.config;
    }

    const result = await app.pg.query<DeductionRow>(
      `UPDATE payroll_deductions
          SET name       = COALESCE($1, name),
              active     = COALESCE($2, active),
              sort_order = COALESCE($3, sort_order),
              affects_garnishment_base = COALESCE($10, affects_garnishment_base),
              rate       = $4,
              amount     = $5,
              brackets   = $6::jsonb,
              config     = $7::jsonb,
              updated_at = now()
        WHERE id = $8 AND user_id = $9
        RETURNING id, user_id, name, kind, rate, amount, brackets, config, active, affects_garnishment_base, sort_order, created_at, updated_at`,
      [
        body.name ?? null,
        body.active ?? null,
        body.sortOrder ?? null,
        newRate,
        newAmount,
        newBrackets ? JSON.stringify(newBrackets) : null,
        newConfig ? JSON.stringify(newConfig) : null,
        id,
        userId,
        body.affectsGarnishmentBase ?? null,
      ],
    );
    return mapRow(result.rows[0]);
  });

  app.delete('/payroll/deductions/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const id = (request.params as { id: string }).id;
    const result = await app.pg.query(
      'DELETE FROM payroll_deductions WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    if (result.rowCount === 0) throw new NotFoundError('Deduction not found');
    reply.code(204);
    return null;
  });

  // Insert the Costa Rica default set for users who don't have these names yet.
  // Idempotent: skips any names that already exist for the user.
  app.post('/payroll/deductions/seed-defaults', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const existing = await app.pg.query<{ name: string }>(
      'SELECT name FROM payroll_deductions WHERE user_id = $1',
      [userId],
    );
    const have = new Set(existing.rows.map((r) => r.name.toLowerCase()));
    let inserted = 0;
    for (let i = 0; i < CR_DEFAULTS.length; i++) {
      const d = CR_DEFAULTS[i];
      if (have.has(d.name.toLowerCase())) continue;
      const rate = d.kind === 'percentage' ? d.rate : null;
      const amount = d.kind === 'fixed' ? d.amount : null;
      const brackets = d.kind === 'progressive' ? JSON.stringify(d.brackets) : null;
      const config = d.kind === 'garnishment' ? JSON.stringify(d.config) : null;
      await app.pg.query(
        `INSERT INTO payroll_deductions (user_id, name, kind, rate, amount, brackets, config, affects_garnishment_base, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
        [userId, d.name, d.kind, rate, amount, brackets, config, d.affectsGarnishmentBase ?? false, i],
      );
      inserted++;
    }
    return { inserted };
  });

  /**
   * Two-pass calculation:
   *   1. Compute non-garnishment deductions (CCSS, Renta, fixed, etc.) from gross.
   *   2. netBeforeGarnishment = gross - sum(non-garnishment)
   *   3. Compute garnishment deductions against netBeforeGarnishment.
   *   4. net = netBeforeGarnishment - sum(garnishment)
   */
  app.post('/payroll/calculate', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const body = calculateSchema.parse(request.body);

    const result = await app.pg.query<DeductionRow>(
      `SELECT id, user_id, name, kind, rate, amount, brackets, config, active, affects_garnishment_base, sort_order, created_at, updated_at
         FROM payroll_deductions
        WHERE user_id = $1
          AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
          AND ($2::uuid[] IS NOT NULL OR active = true)
        ORDER BY sort_order ASC, lower(name) ASC`,
      [userId, body.deductionIds && body.deductionIds.length > 0 ? body.deductionIds : null],
    );
    const all = result.rows.map(mapRow);

    // Pass 1: non-garnishment deductions, applied to gross.
    const preItems = all
      .filter((d) => d.kind !== 'garnishment')
      .map((d) => {
        const override = body.overrides?.[d.id];
        const computed = nonGarnishmentAmount(body.gross, d, override?.amount);
        return {
          id: d.id,
          name: d.name,
          kind: d.kind,
          rate: d.rate,
          brackets: d.brackets,
          config: null as GarnishmentConfig | null,
          ranges: null as GarnishmentRange[] | null,
          amount: round2(computed),
          affectsGarnishmentBase: d.affectsGarnishmentBase,
        };
      });

    const preTotal = preItems.reduce((s, i) => s + i.amount, 0);
    // Only statutory deductions (CCSS, Operadora de Pensiones, Impuesto de Renta)
    // reduce the salario líquido used as the judicial garnishment base.
    const garnishmentBaseDeductions = preItems
      .filter((i) => i.affectsGarnishmentBase)
      .reduce((s, i) => s + i.amount, 0);
    const netBeforeGarnishment = round2(body.gross - garnishmentBaseDeductions);

    // Pass 2: garnishment deductions, applied to net before garnishment.
    const garnishItems = all
      .filter((d) => d.kind === 'garnishment')
      .map((d) => {
        const override = body.overrides?.[d.id];
        if (override?.amount !== undefined) {
          return {
            id: d.id,
            name: d.name,
            kind: d.kind,
            rate: null as number | null,
            brackets: null as Bracket[] | null,
            config: d.config,
            ranges: null as GarnishmentRange[] | null,
            amount: round2(override.amount),
          };
        }
        const { total, ranges } = d.config
          ? calcGarnishment(Math.max(0, netBeforeGarnishment), d.config)
          : { total: 0, ranges: [] as GarnishmentRange[] };
        return {
          id: d.id,
          name: d.name,
          kind: d.kind,
          rate: null as number | null,
          brackets: null as Bracket[] | null,
          config: d.config,
          ranges,
          amount: round2(total),
        };
      });

    const garnishTotal = garnishItems.reduce((s, i) => s + i.amount, 0);
    const totalDeductions = round2(preTotal + garnishTotal);

    return {
      gross: body.gross,
      deductions: [...preItems, ...garnishItems],
      preGarnishmentTotal: round2(preTotal),
      netBeforeGarnishment,
      garnishmentTotal: round2(garnishTotal),
      totalDeductions,
      net: round2(body.gross - totalDeductions),
    };
  });
}
