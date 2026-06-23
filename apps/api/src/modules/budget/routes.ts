import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { calcProgressive, calcGarnishment } from '../payroll/routes.js';

type Cadence = 'monthly' | 'semi_monthly' | 'none';
type Recurrence = 'monthly' | 'weekly' | 'biweekly' | 'manual';
type PeriodSlot = 'first' | 'second' | 'both' | 'manual';
type EntryType = 'planned' | 'unplanned';
type SpaceRole = 'owner' | 'editor';

const createSpaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  cadence: z.enum(['monthly', 'semi_monthly', 'none']).default('semi_monthly'),
});

const updateSpaceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  cadence: z.enum(['monthly', 'semi_monthly', 'none']).optional(),
  exchangeRate: z.coerce.number().positive().max(100000).optional(),
  autoExchangeRate: z.boolean().optional(),
  includeInMonthly: z.boolean().optional(),
});

const monthlyEntrySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  kind: z.enum(['income', 'deduction']),
  label: z.string().trim().min(1).max(120),
  amount: z.coerce.number().min(0),
  recurring: z.boolean().optional(),
  libraryDeductionId: z.string().uuid().nullable().optional(),
  subjectToDeductions: z.boolean().optional(),
});

const updateMonthlyEntrySchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  amount: z.coerce.number().min(0).optional(),
  recurring: z.boolean().optional(),
  libraryDeductionId: z.string().uuid().nullable().optional(),
  subjectToDeductions: z.boolean().optional(),
  amountOverridden: z.boolean().optional(),
});

const shareSpaceSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['editor']).default('editor'),
});

const createPeriodsSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  generateSemiMonthly: z.boolean().default(true),
  label: z.string().trim().min(1).max(120).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  periodIndex: z.coerce.number().int().min(1).max(2).nullable().optional(),
  isCurrent: z.boolean().optional(),
});

const updatePeriodSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  isCurrent: z.boolean().optional(),
});

const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(180),
  defaultAmount: z.coerce.number().nonnegative(),
  recurrence: z.enum(['monthly', 'weekly', 'biweekly', 'manual']).default('manual'),
  defaultPeriodSlot: z.enum(['first', 'second', 'both', 'manual']).default('manual'),
  dueDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
  active: z.boolean().optional(),
  category: z.string().trim().max(120).nullable().optional(),
});

const updateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(180).optional(),
  defaultAmount: z.coerce.number().nonnegative().optional(),
  recurrence: z.enum(['monthly', 'weekly', 'biweekly', 'manual']).optional(),
  defaultPeriodSlot: z.enum(['first', 'second', 'both', 'manual']).optional(),
  dueDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
  active: z.boolean().optional(),
  category: z.string().trim().max(120).nullable().optional(),
});

const createItemSchema = z.object({
  templateId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(220),
  amount: z.coerce.number().nonnegative(),
  paid: z.boolean().optional(),
  entryType: z.enum(['planned', 'unplanned']).default('planned'),
  dueDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
  category: z.string().trim().max(120).nullable().optional(),
});

const updateItemSchema = z.object({
  name: z.string().trim().min(1).max(220).optional(),
  amount: z.coerce.number().nonnegative().optional(),
  paid: z.boolean().optional(),
  dueDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
  entryType: z.enum(['planned', 'unplanned']).optional(),
  category: z.string().trim().max(120).nullable().optional(),
});

const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
});

const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  sortOrder: z.coerce.number().int().optional(),
});

function formatLabel(startIso: string, endIso: string): string {
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  const month = start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${month} ${start.getUTCDate()}-${end.getUTCDate()}`;
}

function monthLastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function semiMonthlyRanges(year: number, month: number): Array<{ idx: number; start: string; end: string; label: string }> {
  const lastDay = monthLastDay(year, month);
  const firstStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const firstEnd = `${year}-${String(month).padStart(2, '0')}-15`;
  const secondStart = `${year}-${String(month).padStart(2, '0')}-16`;
  const secondEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return [
    { idx: 1, start: firstStart, end: firstEnd, label: formatLabel(firstStart, firstEnd) },
    { idx: 2, start: secondStart, end: secondEnd, label: formatLabel(secondStart, secondEnd) },
  ];
}

async function checkSpaceAccess(app: FastifyInstance, spaceId: string, userId: string): Promise<SpaceRole> {
  const ownerCheck = await app.pg.query(
    'SELECT id FROM budget_spaces WHERE id = $1 AND owner_user_id = $2',
    [spaceId, userId],
  );
  if (ownerCheck.rows.length > 0) return 'owner';

  const memberCheck = await app.pg.query(
    'SELECT role FROM budget_space_members WHERE space_id = $1 AND user_id = $2',
    [spaceId, userId],
  );
  if (memberCheck.rows.length > 0) return memberCheck.rows[0].role as SpaceRole;

  throw new ForbiddenError();
}

async function assertSpaceAccess(app: FastifyInstance, spaceId: string, userId: string): Promise<SpaceRole> {
  return checkSpaceAccess(app, spaceId, userId);
}

async function assertPeriodOwner(app: FastifyInstance, periodId: string, userId: string): Promise<{ space_id: string }> {
  const check = await app.pg.query(
    `SELECT bp.id, bp.space_id
     FROM budget_periods bp
     JOIN budget_spaces bs ON bs.id = bp.space_id
     LEFT JOIN budget_space_members bsm ON bsm.space_id = bs.id AND bsm.user_id = $2
     WHERE bp.id = $1 AND (bs.owner_user_id = $2 OR bsm.user_id = $2)`,
    [periodId, userId],
  );
  if (check.rows.length === 0) throw new ForbiddenError();
  return { space_id: check.rows[0].space_id as string };
}

async function assertTemplateOwner(app: FastifyInstance, templateId: string, userId: string): Promise<{ space_id: string }> {
  const check = await app.pg.query(
    `SELECT et.id, et.space_id
     FROM expense_templates et
     JOIN budget_spaces bs ON bs.id = et.space_id
     LEFT JOIN budget_space_members bsm ON bsm.space_id = bs.id AND bsm.user_id = $2
     WHERE et.id = $1 AND (bs.owner_user_id = $2 OR bsm.user_id = $2)`,
    [templateId, userId],
  );
  if (check.rows.length === 0) throw new ForbiddenError();
  return { space_id: check.rows[0].space_id as string };
}

async function assertItemOwner(app: FastifyInstance, itemId: string, userId: string): Promise<void> {
  const check = await app.pg.query(
    `SELECT pe.id
     FROM planned_expenses pe
     JOIN budget_periods bp ON bp.id = pe.period_id
     JOIN budget_spaces bs ON bs.id = bp.space_id
     LEFT JOIN budget_space_members bsm ON bsm.space_id = bs.id AND bsm.user_id = $2
     WHERE pe.id = $1 AND (bs.owner_user_id = $2 OR bsm.user_id = $2)`,
    [itemId, userId],
  );
  if (check.rows.length === 0) throw new ForbiddenError();
}

async function setCurrentPeriod(app: FastifyInstance, spaceId: string, periodId: string): Promise<void> {
  await app.pg.query('UPDATE budget_periods SET is_current = false, updated_at = now() WHERE space_id = $1', [spaceId]);
  await app.pg.query('UPDATE budget_periods SET is_current = true, updated_at = now() WHERE id = $1', [periodId]);
}

async function ensureCurrentPeriod(app: FastifyInstance, spaceId: string, cadence: Cadence): Promise<any> {
  if (cadence === 'none') {
    const inserted = await app.pg.query(
      `INSERT INTO budget_periods (space_id, label, year, month, start_date, end_date, period_index, is_current)
       VALUES ($1, 'Future purchases', 2100, 12, '2000-01-01', '2100-12-31', NULL, false)
       ON CONFLICT (space_id, year, month) WHERE period_index IS NULL
       DO UPDATE SET label = EXCLUDED.label, updated_at = now()
       RETURNING *`,
      [spaceId],
    );
    await setCurrentPeriod(app, spaceId, inserted.rows[0].id as string);
    return { ...inserted.rows[0], is_current: true };
  }

  const today = new Date();
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  const todayIso = `${y}-${String(m).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;

  // If the user has already chosen a current period, respect it. Only auto-pick
  // a current period when none exists.
  const existingCurrent = await app.pg.query(
    `SELECT * FROM budget_periods
     WHERE space_id = $1 AND is_current = true
       AND NOT (year = 2100 AND month = 12 AND label = 'Future purchases')
     LIMIT 1`,
    [spaceId],
  );
  if (existingCurrent.rows.length > 0) {
    return existingCurrent.rows[0];
  }

  let active = await app.pg.query(
    `SELECT * FROM budget_periods
     WHERE space_id = $1
       AND $2::date BETWEEN start_date AND end_date
       AND NOT (year = 2100 AND month = 12 AND label = 'Future purchases')
     ORDER BY start_date ASC
     LIMIT 1`,
    [spaceId, todayIso],
  );

  if (active.rows.length === 0) {
    if (cadence === 'semi_monthly') {
      const ranges = semiMonthlyRanges(y, m);
      for (const range of ranges) {
        await app.pg.query(
          `INSERT INTO budget_periods (space_id, label, year, month, start_date, end_date, period_index, is_current)
           VALUES ($1, $2, $3, $4, $5, $6, $7, false)
           ON CONFLICT (space_id, year, month, period_index) WHERE period_index IS NOT NULL
           DO NOTHING`,
          [spaceId, range.label, y, m, range.start, range.end, range.idx],
        );
      }
    } else {
      const start = `${y}-${String(m).padStart(2, '0')}-01`;
      const end = `${y}-${String(m).padStart(2, '0')}-${String(monthLastDay(y, m)).padStart(2, '0')}`;
      await app.pg.query(
        `INSERT INTO budget_periods (space_id, label, year, month, start_date, end_date, period_index, is_current)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, false)
         ON CONFLICT (space_id, year, month) WHERE period_index IS NULL
         DO NOTHING`,
        [spaceId, formatLabel(start, end), y, m, start, end],
      );
    }

    active = await app.pg.query(
      `SELECT * FROM budget_periods
       WHERE space_id = $1
         AND $2::date BETWEEN start_date AND end_date
         AND NOT (year = 2100 AND month = 12 AND label = 'Future purchases')
       ORDER BY start_date ASC
       LIMIT 1`,
      [spaceId, todayIso],
    );
  }

  const current = active.rows[0] ?? null;
  if (!current) throw new NotFoundError('No period available');

  if (!current.is_current) {
    await setCurrentPeriod(app, spaceId, current.id as string);
  }

  return { ...current, is_current: true };
}

function mapSpaceRow(row: any, userId?: string) {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    isOwner: userId ? row.owner_user_id === userId : undefined,
    name: row.name,
    cadence: row.cadence as Cadence,
    exchangeRate: row.exchange_rate !== undefined && row.exchange_rate !== null ? Number(row.exchange_rate) : 540,
    autoExchangeRate: row.auto_exchange_rate !== undefined ? row.auto_exchange_rate !== false : true,
    includeInMonthly: row.include_in_monthly === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPeriodRow(row: any) {
  return {
    id: row.id,
    spaceId: row.space_id,
    label: row.label,
    year: row.year,
    month: row.month,
    startDate: row.start_date,
    endDate: row.end_date,
    periodIndex: row.period_index,
    isCurrent: row.is_current,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTemplateRow(row: any) {
  return {
    id: row.id,
    spaceId: row.space_id,
    name: row.name,
    defaultAmount: Number(row.default_amount),
    recurrence: row.recurrence as Recurrence,
    defaultPeriodSlot: row.default_period_slot as PeriodSlot,
    dueDay: row.due_day,
    active: row.active,
    category: row.category ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getSpaceLibrary(app: FastifyInstance, spaceId: string) {
  const result = await app.pg.query(
    `SELECT * FROM expense_templates
     WHERE space_id = $1
     ORDER BY active DESC, lower(name) ASC`,
    [spaceId],
  );

  return result.rows.map(mapTemplateRow);
}

function mapItemRow(row: any) {
  return {
    id: row.id,
    periodId: row.period_id,
    templateId: row.template_id,
    name: row.name,
    amount: Number(row.amount),
    paid: row.paid,
    entryType: row.entry_type as EntryType,
    dueDay: row.due_day,
    category: row.category ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureCategory(app: FastifyInstance, spaceId: string, name: string | null | undefined): Promise<void> {
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  await app.pg.query(
    `INSERT INTO budget_categories (space_id, name, sort_order)
     SELECT $1, $2, COALESCE((SELECT MAX(sort_order) + 1 FROM budget_categories WHERE space_id = $1), 0)
     ON CONFLICT (space_id, name) DO NOTHING`,
    [spaceId, trimmed],
  );
}

async function assertCategoryOwner(app: FastifyInstance, categoryId: string, userId: string): Promise<{ space_id: string; name: string }> {
  const res = await app.pg.query(
    `SELECT bc.space_id, bc.name, bs.owner_user_id
     FROM budget_categories bc
     JOIN budget_spaces bs ON bs.id = bc.space_id
     WHERE bc.id = $1`,
    [categoryId],
  );
  if (res.rows.length === 0) throw new NotFoundError('Category not found');
  const row = res.rows[0];
  if (row.owner_user_id !== userId) {
    // editors may also manage categories
    const member = await app.pg.query(
      'SELECT 1 FROM budget_space_members WHERE space_id = $1 AND user_id = $2',
      [row.space_id, userId],
    );
    if (member.rows.length === 0) throw new ForbiddenError('Not allowed');
  }
  return { space_id: row.space_id, name: row.name };
}

// Live USD→CRC exchange rate, cached in Redis. Falls back to last cached value on upstream failure.
// Source: api.hacienda.go.cr (official Costa Rica Ministry of Finance, daily compra/venta).
// We use the *compra* (buy) value — what banks pay when buying dollars, which is the
// rate locals use for budgeting incoming USD.
const EXCHANGE_RATE_CACHE_KEY = 'budget:exchange-rate:USD:CRC:v2';
const EXCHANGE_RATE_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const EXCHANGE_RATE_STALE_KEY = 'budget:exchange-rate:USD:CRC:v2:stale';

async function fetchLiveExchangeRate(app: FastifyInstance): Promise<{ rate: number; buy: number; sell: number; source: string; fetchedAt: string } | null> {
  try {
    const cached = await app.redis.get(EXCHANGE_RATE_CACHE_KEY);
    if (cached) {
      try { return JSON.parse(cached); } catch { /* fall through */ }
    }
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, 'exchange-rate: redis read failed');
  }

  // Cache miss → hit upstream with a short timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch('https://api.hacienda.go.cr/indicadores/tc', { signal: controller.signal });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const body = await res.json() as { dolar?: { compra?: { valor?: number; fecha?: string }; venta?: { valor?: number; fecha?: string } } };
    const buy = body?.dolar?.compra?.valor;
    const sell = body?.dolar?.venta?.valor;
    const fecha = body?.dolar?.compra?.fecha ?? body?.dolar?.venta?.fecha;
    if (typeof buy !== 'number' || !(buy > 0) || typeof sell !== 'number' || !(sell > 0)) {
      throw new Error('invalid upstream payload');
    }
    const payload = {
      rate: Number(buy.toFixed(4)), // primary = buy (compra)
      buy: Number(buy.toFixed(4)),
      sell: Number(sell.toFixed(4)),
      source: 'api.hacienda.go.cr',
      fetchedAt: fecha ? new Date(`${fecha}T00:00:00Z`).toISOString() : new Date().toISOString(),
    };
    try {
      await app.redis.set(EXCHANGE_RATE_CACHE_KEY, JSON.stringify(payload), { EX: EXCHANGE_RATE_TTL_SECONDS });
      await app.redis.set(EXCHANGE_RATE_STALE_KEY, JSON.stringify(payload), { EX: 30 * 24 * 60 * 60 });
    } catch (err) {
      app.log.warn({ err: (err as Error).message }, 'exchange-rate: redis write failed');
    }

    // Propagate the new rate to every budget space that hasn't been manually
    // overridden. New spaces start with auto_exchange_rate = true, so this
    // covers "actual and future" automatically.
    try {
      const result = await app.pg.query(
        `UPDATE budget_spaces
            SET exchange_rate = $1,
                updated_at = now()
          WHERE auto_exchange_rate = true
            AND abs(exchange_rate - $1) > 0.0001`,
        [payload.rate],
      );
      if (result.rowCount && result.rowCount > 0) {
        app.log.info({ rowCount: result.rowCount, rate: payload.rate }, 'exchange-rate: bulk-updated auto budget spaces');
      }
    } catch (err) {
      app.log.warn({ err: (err as Error).message }, 'exchange-rate: bulk-update failed');
    }

    return payload;
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, 'exchange-rate: upstream fetch failed');
    try {
      const stale = await app.redis.get(EXCHANGE_RATE_STALE_KEY);
      if (stale) return JSON.parse(stale);
    } catch { /* ignore */ }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async function budgetRoutes(app: FastifyInstance) {
  // Live USD→CRC exchange rate (cached). Not space-scoped; safe to expose to any
  // authenticated user. Returns 503 if upstream is down AND no stale cache exists.
  app.get('/budget/exchange-rate', { preHandler: [app.authenticate] }, async (_request, reply) => {
    const data = await fetchLiveExchangeRate(app);
    if (!data) {
      return reply.status(503).send({ error: 'Exchange rate temporarily unavailable' });
    }
    return data;
  });

  // Spaces
  app.get('/budget/spaces', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const spaces = await app.pg.query(
      `SELECT DISTINCT bs.id, bs.owner_user_id, u.name AS owner_name, bs.name, bs.cadence, bs.created_at, bs.updated_at,
          lower(bs.name) AS sort_name
       FROM budget_spaces bs
       JOIN users u ON u.id = bs.owner_user_id
       LEFT JOIN budget_space_members bsm ON bsm.space_id = bs.id
       WHERE bs.owner_user_id = $1 OR bsm.user_id = $1
      ORDER BY sort_name ASC`,
      [userId],
    );

    const items: any[] = [];
    for (const row of spaces.rows) {
      const current = await ensureCurrentPeriod(app, row.id as string, row.cadence as Cadence);
      const rate = row.exchange_rate !== null && row.exchange_rate !== undefined ? Number(row.exchange_rate) : 540;
      const stats = await app.pg.query(
        `SELECT
            count(*) FILTER (WHERE entry_type = 'planned') AS planned_count,
            count(*) FILTER (WHERE entry_type = 'unplanned') AS unplanned_count,
            count(*) FILTER (WHERE paid = false) AS unpaid_count,
            coalesce(sum(CASE WHEN amount < 6000 THEN amount * $2 ELSE amount END), 0) AS total_amount
         FROM planned_expenses
         WHERE period_id = $1`,
        [current.id, rate],
      );
      const s = stats.rows[0];
      items.push({
        ...mapSpaceRow(row, userId),
        currentPeriod: mapPeriodRow(current),
        summary: {
          plannedCount: Number(s.planned_count),
          unplannedCount: Number(s.unplanned_count),
          unpaidCount: Number(s.unpaid_count),
          totalAmount: Number(s.total_amount),
        },
      });
    }

    return { items };
  });

  app.post('/budget/spaces', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = createSpaceSchema.parse(request.body);
    const userId = request.user.sub;

    const created = await app.pg.query(
      `INSERT INTO budget_spaces (owner_user_id, name, cadence)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, body.name, body.cadence],
    );
    const space = created.rows[0];

    // Seed current month periods for smooth first-run UX.
    await ensureCurrentPeriod(app, space.id as string, body.cadence);

    return reply.status(201).send(mapSpaceRow(space));
  });

  app.get('/budget/spaces/:spaceId', { preHandler: [app.authenticate] }, async (request) => {
    const { spaceId } = request.params as { spaceId: string };
    const userId = request.user.sub;

    await assertSpaceAccess(app, spaceId, userId);

    const result = await app.pg.query(
      `SELECT bs.*, u.name AS owner_name
       FROM budget_spaces bs
       JOIN users u ON u.id = bs.owner_user_id
       WHERE bs.id = $1`,
      [spaceId],
    );
    if (result.rows.length === 0) throw new NotFoundError('Space not found');

    const members = await app.pg.query(
      `SELECT bsm.user_id, bsm.role, u.name, u.email
       FROM budget_space_members bsm
       JOIN users u ON u.id = bsm.user_id
       WHERE bsm.space_id = $1
       ORDER BY lower(u.name) ASC`,
      [spaceId],
    );
    const library = await getSpaceLibrary(app, spaceId);

    const row = result.rows[0];
    const current = await ensureCurrentPeriod(app, spaceId, row.cadence as Cadence);
    return {
      ...mapSpaceRow(row, userId),
      currentPeriod: mapPeriodRow(current),
      members: members.rows.map((m) => ({
        userId: m.user_id,
        name: m.name,
        email: m.email,
        role: m.role,
      })),
      library,
    };
  });

  app.put('/budget/spaces/:spaceId', { preHandler: [app.authenticate] }, async (request) => {
    const { spaceId } = request.params as { spaceId: string };
    const body = updateSpaceSchema.parse(request.body);
    const userId = request.user.sub;

    await assertSpaceAccess(app, spaceId, userId);

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(body.name);
    }
    if (body.cadence !== undefined) {
      sets.push(`cadence = $${idx++}`);
      values.push(body.cadence);
    }

    // Auto-rate semantics:
    //   - explicit { autoExchangeRate: true }  → re-enable auto and snap to the
    //     latest live rate (overrides any exchangeRate also sent in the same body)
    //   - explicit { autoExchangeRate: false } → disable auto, keep current/new rate
    //   - { exchangeRate: number } alone       → treated as manual override → auto=false
    let appliedRate: number | null = null;
    let appliedAuto: boolean | null = null;
    if (body.autoExchangeRate === true) {
      const live = await fetchLiveExchangeRate(app);
      appliedAuto = true;
      if (live) {
        appliedRate = live.rate;
      }
    } else if (body.autoExchangeRate === false) {
      appliedAuto = false;
    } else if (body.exchangeRate !== undefined) {
      // Manual edit without explicit flag → user is overriding.
      appliedAuto = false;
    }
    if (body.exchangeRate !== undefined && appliedRate === null) {
      appliedRate = body.exchangeRate;
    }
    if (appliedRate !== null) {
      sets.push(`exchange_rate = $${idx++}`);
      values.push(appliedRate);
    }
    if (appliedAuto !== null) {
      sets.push(`auto_exchange_rate = $${idx++}`);
      values.push(appliedAuto);
    }
    if (body.includeInMonthly !== undefined) {
      sets.push(`include_in_monthly = $${idx++}`);
      values.push(body.includeInMonthly);
    }

    if (sets.length === 0) throw new BadRequestError('No fields to update');

    sets.push('updated_at = now()');
    values.push(spaceId);
    const result = await app.pg.query(
      `UPDATE budget_spaces SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );

    return mapSpaceRow(result.rows[0]);
  });

  app.delete('/budget/spaces/:spaceId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { spaceId } = request.params as { spaceId: string };
    const userId = request.user.sub;

    const check = await app.pg.query('SELECT owner_user_id FROM budget_spaces WHERE id = $1', [spaceId]);
    if (check.rows.length === 0) throw new NotFoundError('Space not found');
    if (check.rows[0].owner_user_id !== userId) throw new ForbiddenError();

    await app.pg.query('DELETE FROM budget_spaces WHERE id = $1', [spaceId]);
    return reply.status(204).send();
  });

  app.post('/budget/spaces/:spaceId/share', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { spaceId } = request.params as { spaceId: string };
    const body = shareSpaceSchema.parse(request.body);
    const userId = request.user.sub;

    const check = await app.pg.query('SELECT owner_user_id FROM budget_spaces WHERE id = $1', [spaceId]);
    if (check.rows.length === 0) throw new NotFoundError('Space not found');
    if (check.rows[0].owner_user_id !== userId) throw new ForbiddenError();
    if (body.userId === userId) throw new BadRequestError('Cannot share with yourself');

    const friendCheck = await app.pg.query(
      `SELECT id FROM friendships
       WHERE status = 'accepted'
       AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
      [userId, body.userId],
    );
    if (friendCheck.rows.length === 0) throw new BadRequestError('User must be a friend');

    await app.pg.query(
      `INSERT INTO budget_space_members (space_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (space_id, user_id) DO UPDATE SET role = $3`,
      [spaceId, body.userId, body.role],
    );

    const libraryCount = await app.pg.query(
      'SELECT count(*)::int AS count FROM expense_templates WHERE space_id = $1 AND active = true',
      [spaceId],
    );

    return reply.status(201).send({ ok: true, sharedLibrary: true, libraryCount: Number(libraryCount.rows[0].count) });
  });

  app.delete('/budget/spaces/:spaceId/members/:memberId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { spaceId, memberId } = request.params as { spaceId: string; memberId: string };
    const userId = request.user.sub;

    const check = await app.pg.query('SELECT owner_user_id FROM budget_spaces WHERE id = $1', [spaceId]);
    if (check.rows.length === 0) throw new NotFoundError('Space not found');
    if (check.rows[0].owner_user_id !== userId && memberId !== userId) throw new ForbiddenError();

    await app.pg.query('DELETE FROM budget_space_members WHERE space_id = $1 AND user_id = $2', [spaceId, memberId]);
    return reply.status(204).send();
  });

  app.get('/budget/spaces/:spaceId/members', { preHandler: [app.authenticate] }, async (request) => {
    const { spaceId } = request.params as { spaceId: string };
    const userId = request.user.sub;
    await assertSpaceAccess(app, spaceId, userId);

    const owner = await app.pg.query(
      `SELECT u.id AS user_id, u.name, u.email, 'owner' AS role
       FROM budget_spaces bs JOIN users u ON u.id = bs.owner_user_id WHERE bs.id = $1`,
      [spaceId],
    );
    const members = await app.pg.query(
      `SELECT bsm.user_id, u.name, u.email, bsm.role
       FROM budget_space_members bsm
       JOIN users u ON u.id = bsm.user_id
       WHERE bsm.space_id = $1
       ORDER BY lower(u.name) ASC`,
      [spaceId],
    );

    return {
      items: [...owner.rows, ...members.rows].map((m) => ({
        userId: m.user_id,
        name: m.name,
        email: m.email,
        role: m.role,
      })),
    };
  });

  // Periods
  app.get('/budget/spaces/:spaceId/periods/current', { preHandler: [app.authenticate] }, async (request) => {
    const { spaceId } = request.params as { spaceId: string };
    const userId = request.user.sub;

    await assertSpaceAccess(app, spaceId, userId);

    const space = await app.pg.query(
      'SELECT id, cadence FROM budget_spaces WHERE id = $1',
      [spaceId],
    );
    if (space.rows.length === 0) throw new NotFoundError('Space not found');

    const current = await ensureCurrentPeriod(app, spaceId, space.rows[0].cadence as Cadence);
    return mapPeriodRow(current);
  });

  app.get('/budget/spaces/:spaceId/periods', { preHandler: [app.authenticate] }, async (request) => {
    const { spaceId } = request.params as { spaceId: string };
    const userId = request.user.sub;

    await assertSpaceAccess(app, spaceId, userId);

    const result = await app.pg.query(
      `SELECT * FROM budget_periods
       WHERE space_id = $1
       ORDER BY start_date DESC`,
      [spaceId],
    );

    return { items: result.rows.map(mapPeriodRow) };
  });

  app.get('/budget/periods/:periodId', { preHandler: [app.authenticate] }, async (request) => {
    const { periodId } = request.params as { periodId: string };
    const userId = request.user.sub;

    await assertPeriodOwner(app, periodId, userId);

    const period = await app.pg.query('SELECT * FROM budget_periods WHERE id = $1', [periodId]);
    if (period.rows.length === 0) throw new NotFoundError('Period not found');

    const spaceRow = await app.pg.query(
      'SELECT exchange_rate FROM budget_spaces WHERE id = $1',
      [period.rows[0].space_id],
    );
    const rate = spaceRow.rows[0]?.exchange_rate !== null && spaceRow.rows[0]?.exchange_rate !== undefined
      ? Number(spaceRow.rows[0].exchange_rate)
      : 540;

    const stats = await app.pg.query(
      `SELECT
          count(*) FILTER (WHERE entry_type = 'planned') AS planned_count,
          count(*) FILTER (WHERE entry_type = 'unplanned') AS unplanned_count,
          count(*) FILTER (WHERE paid = false) AS unpaid_count,
          coalesce(sum(CASE WHEN amount < 6000 THEN amount * $2 ELSE amount END), 0) AS total_amount
       FROM planned_expenses
       WHERE period_id = $1`,
      [periodId, rate],
    );

    const s = stats.rows[0];
    return {
      ...mapPeriodRow(period.rows[0]),
      summary: {
        plannedCount: Number(s.planned_count),
        unplannedCount: Number(s.unplanned_count),
        unpaidCount: Number(s.unpaid_count),
        totalAmount: Number(s.total_amount),
      },
    };
  });

  app.post('/budget/spaces/:spaceId/periods', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { spaceId } = request.params as { spaceId: string };
    const body = createPeriodsSchema.parse(request.body);
    const userId = request.user.sub;

    await assertSpaceAccess(app, spaceId, userId);

    const space = await app.pg.query(
      'SELECT id, cadence FROM budget_spaces WHERE id = $1',
      [spaceId],
    );
    if (space.rows.length === 0) throw new NotFoundError('Space not found');

    const cadence = space.rows[0].cadence as Cadence;

    if (cadence === 'semi_monthly' && body.generateSemiMonthly) {
      const ranges = semiMonthlyRanges(body.year, body.month);
      const out: any[] = [];

      for (const range of ranges) {
        const inserted = await app.pg.query(
          `INSERT INTO budget_periods (space_id, label, year, month, start_date, end_date, period_index, is_current)
           VALUES ($1, $2, $3, $4, $5, $6, $7, false)
           ON CONFLICT (space_id, year, month, period_index) WHERE period_index IS NOT NULL
           DO UPDATE SET label = EXCLUDED.label, updated_at = now()
           RETURNING *`,
          [spaceId, range.label, body.year, body.month, range.start, range.end, range.idx],
        );
        out.push(mapPeriodRow(inserted.rows[0]));
      }

      return reply.status(201).send({ items: out });
    }

    if (!body.startDate || !body.endDate || !body.label) {
      throw new BadRequestError('label, startDate and endDate are required for manual period creation');
    }

    if (body.startDate > body.endDate) throw new BadRequestError('startDate must be before endDate');

    const inserted = await app.pg.query(
      `INSERT INTO budget_periods
        (space_id, label, year, month, start_date, end_date, period_index, is_current)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        spaceId,
        body.label,
        body.year,
        body.month,
        body.startDate,
        body.endDate,
        body.periodIndex ?? null,
        body.isCurrent ?? false,
      ],
    );

    const period = inserted.rows[0];
    if (period.is_current) await setCurrentPeriod(app, spaceId, period.id as string);

    return reply.status(201).send(mapPeriodRow(period));
  });

  app.put('/budget/periods/:periodId', { preHandler: [app.authenticate] }, async (request) => {
    const { periodId } = request.params as { periodId: string };
    const body = updatePeriodSchema.parse(request.body);
    const userId = request.user.sub;

    const owner = await assertPeriodOwner(app, periodId, userId);

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.label !== undefined) {
      sets.push(`label = $${idx++}`);
      values.push(body.label);
    }
    if (body.startDate !== undefined) {
      sets.push(`start_date = $${idx++}`);
      values.push(body.startDate);
    }
    if (body.endDate !== undefined) {
      sets.push(`end_date = $${idx++}`);
      values.push(body.endDate);
    }
    if (body.isCurrent !== undefined) {
      sets.push(`is_current = $${idx++}`);
      values.push(body.isCurrent);
    }

    if (sets.length === 0) throw new BadRequestError('No fields to update');

    sets.push('updated_at = now()');
    values.push(periodId);

    // If marking this period current, clear any other current period for the space first
    // to avoid violating the uq_budget_period_current_per_space partial unique index.
    if (body.isCurrent === true) {
      await app.pg.query(
        'UPDATE budget_periods SET is_current = false, updated_at = now() WHERE space_id = $1 AND id <> $2 AND is_current = true',
        [owner.space_id, periodId],
      );
    }

    const result = await app.pg.query(
      `UPDATE budget_periods SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );

    if (result.rows.length === 0) throw new NotFoundError('Period not found');

    const row = result.rows[0];
    if (body.isCurrent === true) {
      await setCurrentPeriod(app, owner.space_id, periodId);
    }

    return mapPeriodRow(row);
  });

  // Expense Library
  app.get('/budget/spaces/:spaceId/library', { preHandler: [app.authenticate] }, async (request) => {
    const { spaceId } = request.params as { spaceId: string };
    const userId = request.user.sub;

    await assertSpaceAccess(app, spaceId, userId);

    return { items: await getSpaceLibrary(app, spaceId) };
  });

  app.post('/budget/spaces/:spaceId/library', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { spaceId } = request.params as { spaceId: string };
    const userId = request.user.sub;
    const body = createTemplateSchema.parse(request.body);

    await assertSpaceAccess(app, spaceId, userId);

    const inserted = await app.pg.query(
      `INSERT INTO expense_templates
        (space_id, name, default_amount, recurrence, default_period_slot, due_day, active, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        spaceId,
        body.name,
        body.defaultAmount,
        body.recurrence,
        body.defaultPeriodSlot,
        body.dueDay ?? null,
        body.active ?? true,
        body.category?.trim() || null,
      ],
    );

    await ensureCategory(app, spaceId, body.category ?? null);

    return reply.status(201).send(mapTemplateRow(inserted.rows[0]));
  });

  app.put('/budget/library/:templateId', { preHandler: [app.authenticate] }, async (request) => {
    const { templateId } = request.params as { templateId: string };
    const userId = request.user.sub;
    const body = updateTemplateSchema.parse(request.body);

    await assertTemplateOwner(app, templateId, userId);

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(body.name);
    }
    if (body.defaultAmount !== undefined) {
      sets.push(`default_amount = $${idx++}`);
      values.push(body.defaultAmount);
    }
    if (body.recurrence !== undefined) {
      sets.push(`recurrence = $${idx++}`);
      values.push(body.recurrence);
    }
    if (body.defaultPeriodSlot !== undefined) {
      sets.push(`default_period_slot = $${idx++}`);
      values.push(body.defaultPeriodSlot);
    }
    if (body.dueDay !== undefined) {
      sets.push(`due_day = $${idx++}`);
      values.push(body.dueDay ?? null);
    }
    if (body.active !== undefined) {
      sets.push(`active = $${idx++}`);
      values.push(body.active);
    }
    if (body.category !== undefined) {
      sets.push(`category = $${idx++}`);
      const cat = body.category?.trim() || null;
      values.push(cat);
    }

    if (sets.length === 0) throw new BadRequestError('No fields to update');

    sets.push('updated_at = now()');
    values.push(templateId);

    const updated = await app.pg.query(
      `UPDATE expense_templates SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );

    if (updated.rows.length === 0) throw new NotFoundError('Template not found');

    if (body.category !== undefined) {
      await ensureCategory(app, updated.rows[0].space_id as string, body.category ?? null);
    }

    return mapTemplateRow(updated.rows[0]);
  });

  app.delete('/budget/library/:templateId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { templateId } = request.params as { templateId: string };
    const userId = request.user.sub;

    await assertTemplateOwner(app, templateId, userId);

    await app.pg.query('UPDATE expense_templates SET active = false, updated_at = now() WHERE id = $1', [templateId]);
    return reply.status(204).send();
  });

  app.delete('/budget/library/:templateId/permanent', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { templateId } = request.params as { templateId: string };
    const userId = request.user.sub;

    await assertTemplateOwner(app, templateId, userId);

    // planned_expenses.template_id has ON DELETE SET NULL, so existing items remain.
    await app.pg.query('DELETE FROM expense_templates WHERE id = $1', [templateId]);
    return reply.status(204).send();
  });

  // Categories (sub-sections) for a budget space
  app.get('/budget/spaces/:spaceId/categories', { preHandler: [app.authenticate] }, async (request) => {
    const { spaceId } = request.params as { spaceId: string };
    const userId = request.user.sub;

    await assertSpaceAccess(app, spaceId, userId);

    const result = await app.pg.query(
      `SELECT id, space_id, name, sort_order, created_at, updated_at
       FROM budget_categories
       WHERE space_id = $1
       ORDER BY sort_order ASC, lower(name) ASC`,
      [spaceId],
    );

    return {
      items: result.rows.map((r: any) => ({
        id: r.id,
        spaceId: r.space_id,
        name: r.name,
        sortOrder: r.sort_order,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    };
  });

  app.post('/budget/spaces/:spaceId/categories', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { spaceId } = request.params as { spaceId: string };
    const userId = request.user.sub;
    const body = createCategorySchema.parse(request.body);

    await assertSpaceAccess(app, spaceId, userId);

    const inserted = await app.pg.query(
      `INSERT INTO budget_categories (space_id, name, sort_order)
       VALUES ($1, $2, COALESCE((SELECT MAX(sort_order) + 1 FROM budget_categories WHERE space_id = $1), 0))
       ON CONFLICT (space_id, name) DO UPDATE SET updated_at = now()
       RETURNING *`,
      [spaceId, body.name],
    );

    const row = inserted.rows[0];
    return reply.status(201).send({
      id: row.id,
      spaceId: row.space_id,
      name: row.name,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  });

  app.put('/budget/categories/:categoryId', { preHandler: [app.authenticate] }, async (request) => {
    const { categoryId } = request.params as { categoryId: string };
    const userId = request.user.sub;
    const body = updateCategorySchema.parse(request.body);

    const { space_id: spaceId, name: oldName } = await assertCategoryOwner(app, categoryId, userId);

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(body.name);
    }
    if (body.sortOrder !== undefined) {
      sets.push(`sort_order = $${idx++}`);
      values.push(body.sortOrder);
    }

    if (sets.length === 0) throw new BadRequestError('No fields to update');

    sets.push('updated_at = now()');
    values.push(categoryId);

    const updated = await app.pg.query(
      `UPDATE budget_categories SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );

    if (updated.rows.length === 0) throw new NotFoundError('Category not found');

    // Rename: propagate to templates and planned_expenses tied to this space.
    if (body.name !== undefined && body.name !== oldName) {
      await app.pg.query(
        `UPDATE expense_templates SET category = $1, updated_at = now()
         WHERE space_id = $2 AND category = $3`,
        [body.name, spaceId, oldName],
      );
      await app.pg.query(
        `UPDATE planned_expenses SET category = $1, updated_at = now()
         WHERE category = $3
           AND period_id IN (SELECT id FROM budget_periods WHERE space_id = $2)`,
        [body.name, spaceId, oldName],
      );
    }

    const row = updated.rows[0];
    return {
      id: row.id,
      spaceId: row.space_id,
      name: row.name,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  app.delete('/budget/categories/:categoryId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { categoryId } = request.params as { categoryId: string };
    const userId = request.user.sub;

    const { space_id: spaceId, name } = await assertCategoryOwner(app, categoryId, userId);

    // Detach from templates and items so they show up under "Uncategorized".
    await app.pg.query(
      `UPDATE expense_templates SET category = NULL, updated_at = now()
       WHERE space_id = $1 AND category = $2`,
      [spaceId, name],
    );
    await app.pg.query(
      `UPDATE planned_expenses SET category = NULL, updated_at = now()
       WHERE category = $2
         AND period_id IN (SELECT id FROM budget_periods WHERE space_id = $1)`,
      [spaceId, name],
    );

    await app.pg.query('DELETE FROM budget_categories WHERE id = $1', [categoryId]);
    return reply.status(204).send();
  });

  // Planned / Unplanned Items
  app.get('/budget/periods/:periodId/items', { preHandler: [app.authenticate] }, async (request) => {
    const { periodId } = request.params as { periodId: string };
    const userId = request.user.sub;

    await assertPeriodOwner(app, periodId, userId);

    const result = await app.pg.query(
      `SELECT * FROM planned_expenses
       WHERE period_id = $1
       ORDER BY entry_type ASC, paid ASC, due_day ASC NULLS LAST, created_at ASC`,
      [periodId],
    );

    return { items: result.rows.map(mapItemRow) };
  });

  app.post('/budget/periods/:periodId/items', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { periodId } = request.params as { periodId: string };
    const userId = request.user.sub;
    const body = createItemSchema.parse(request.body);

    await assertPeriodOwner(app, periodId, userId);

    let paid = body.paid;
    if (paid === undefined) paid = body.entryType === 'unplanned';

    const inserted = await app.pg.query(
      `INSERT INTO planned_expenses
        (period_id, template_id, name, amount, paid, entry_type, due_day, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        periodId,
        body.templateId ?? null,
        body.name,
        body.amount,
        paid,
        body.entryType,
        body.dueDay ?? null,
        body.category?.trim() || null,
      ],
    );

    // Make sure the category exists in budget_categories for the parent space.
    if (body.category) {
      const periodRow = await app.pg.query('SELECT space_id FROM budget_periods WHERE id = $1', [periodId]);
      if (periodRow.rows.length > 0) {
        await ensureCategory(app, periodRow.rows[0].space_id as string, body.category);
      }
    }

    return reply.status(201).send(mapItemRow(inserted.rows[0]));
  });

  app.post('/budget/periods/:periodId/build-from-library', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { periodId } = request.params as { periodId: string };
    const userId = request.user.sub;

    await assertPeriodOwner(app, periodId, userId);

    // Load period
    const periodRes = await app.pg.query(
      `SELECT id, space_id, year, month, start_date, end_date, period_index
       FROM budget_periods WHERE id = $1`,
      [periodId],
    );
    if (periodRes.rows.length === 0) throw new NotFoundError('Period not found');
    const period = periodRes.rows[0] as {
      id: string;
      space_id: string;
      year: number;
      month: number;
      start_date: string;
      end_date: string;
      period_index: number | null;
    };

    // Load space (for cadence)
    const spaceRes = await app.pg.query(
      'SELECT cadence FROM budget_spaces WHERE id = $1',
      [period.space_id],
    );
    if (spaceRes.rows.length === 0) throw new NotFoundError('Space not found');
    const cadence = spaceRes.rows[0].cadence as Cadence;

    if (cadence === 'none') {
      throw new BadRequestError('Build is not supported for no-cadence spaces');
    }

    // Load active templates for the space
    const tplRes = await app.pg.query(
      `SELECT id, name, default_amount, recurrence, default_period_slot, due_day, category
       FROM expense_templates
       WHERE space_id = $1 AND active = true`,
      [period.space_id],
    );

    // Existing items per template in this period (count, not just presence)
    const existingRes = await app.pg.query(
      'SELECT template_id, COUNT(*)::int AS n FROM planned_expenses WHERE period_id = $1 AND template_id IS NOT NULL GROUP BY template_id',
      [periodId],
    );
    const existingCountByTemplate = new Map<string, number>(
      existingRes.rows.map((r: any) => [r.template_id as string, Number(r.n)]),
    );

    // Reset paid=true → false for all planned items in this period that came from
    // the library (template-linked). Manual/unplanned items are untouched.
    const resetRes = await app.pg.query(
      `UPDATE planned_expenses
       SET paid = false, updated_at = now()
       WHERE period_id = $1
         AND template_id IS NOT NULL
         AND entry_type = 'planned'
         AND paid = true`,
      [periodId],
    );
    const reset = resetRes.rowCount ?? 0;

    // Sync category from the template onto any existing template-linked items in
    // this period, so newly-assigned subsections on the template propagate even
    // when the item already exists (i.e., re-running Build Budget on a period
    // that was built before categories were assigned).
    await app.pg.query(
      `UPDATE planned_expenses pe
       SET category = et.category, updated_at = now()
       FROM expense_templates et
       WHERE pe.period_id = $1
         AND pe.template_id = et.id
         AND COALESCE(pe.category, '') IS DISTINCT FROM COALESCE(et.category, '')`,
      [periodId],
    );

    // Count Sundays (week start) inclusive between start_date and end_date
    function countSundays(start: string | Date, end: string | Date): number {
      const toUtcDate = (v: string | Date): Date => {
        if (v instanceof Date) {
          return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
        }
        return new Date(`${v}T00:00:00Z`);
      };
      const startDate = toUtcDate(start);
      const endDate = toUtcDate(end);
      let count = 0;
      const cursor = new Date(startDate);
      while (cursor.getTime() <= endDate.getTime()) {
        if (cursor.getUTCDay() === 0) count += 1;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return count;
    }

    // Latest recorded amount for a template across this space's periods (any period)
    async function latestAmount(templateId: string, fallback: number): Promise<number> {
      const r = await app.pg.query(
        `SELECT pe.amount
         FROM planned_expenses pe
         JOIN budget_periods bp ON bp.id = pe.period_id
         WHERE pe.template_id = $1 AND bp.space_id = $2
         ORDER BY pe.updated_at DESC, pe.created_at DESC
         LIMIT 1`,
        [templateId, period.space_id],
      );
      if (r.rows.length === 0) return Number(fallback);
      return Number(r.rows[0].amount);
    }

    const idx = period.period_index; // 1, 2, or null (monthly)
    const isSemi = idx === 1 || idx === 2;
    const weekCount = countSundays(period.start_date, period.end_date);

    const created: any[] = [];
    let skipped = 0;

    for (const tpl of tplRes.rows as Array<{
      id: string;
      name: string;
      default_amount: string | number;
      recurrence: Recurrence;
      default_period_slot: PeriodSlot;
      due_day: number | null;
      category: string | null;
    }>) {
      if (existingCountByTemplate.has(tpl.id) && tpl.recurrence !== 'weekly') {
        skipped += 1;
        continue;
      }

      const amount = await latestAmount(tpl.id, Number(tpl.default_amount));

      // Decide instance count for this period based on recurrence + slot
      let instances = 0;
      if (tpl.recurrence === 'manual') {
        instances = 0;
      } else if (tpl.recurrence === 'monthly') {
        if (isSemi) {
          const slot = tpl.default_period_slot;
          if (slot === 'first') instances = idx === 1 ? 1 : 0;
          else if (slot === 'second') instances = idx === 2 ? 1 : 0;
          else if (slot === 'both') instances = 1; // one per half
          else if (slot === 'manual') {
            // Use due_day to decide: <=15 first, >=16 second; otherwise skip
            if (tpl.due_day != null) {
              if (idx === 1 && tpl.due_day <= 15) instances = 1;
              else if (idx === 2 && tpl.due_day >= 16) instances = 1;
            }
          }
        } else {
          instances = 1; // monthly period: one occurrence
        }
      } else if (tpl.recurrence === 'biweekly') {
        instances = 1; // one per half (semi) or one per month
      } else if (tpl.recurrence === 'weekly') {
        instances = weekCount;
      }

      if (instances <= 0) {
        skipped += 1;
        continue;
      }

      // For weekly templates, only create the missing weeks to top up an
      // existing partial build rather than skipping or duplicating.
      const alreadyHave = existingCountByTemplate.get(tpl.id) ?? 0;
      if (alreadyHave >= instances) {
        skipped += 1;
        continue;
      }
      const startIndex = alreadyHave;

      // If the period already has 1 weekly item without a "(week N)" suffix,
      // rename it so the new ones can be numbered consistently.
      if (tpl.recurrence === 'weekly' && alreadyHave > 0 && instances > 1) {
        await app.pg.query(
          `UPDATE planned_expenses
           SET name = $1 || ' (week ' || (
             SELECT COUNT(*) FROM planned_expenses pe2
             WHERE pe2.period_id = $2 AND pe2.template_id = $3 AND pe2.created_at <= planned_expenses.created_at
           ) || ')'
           WHERE period_id = $2 AND template_id = $3 AND name NOT LIKE '% (week %)'`,
          [tpl.name, periodId, tpl.id],
        );
      }

      for (let i = startIndex; i < instances; i += 1) {
        const displayName = instances > 1 ? `${tpl.name} (week ${i + 1})` : tpl.name;
        const ins = await app.pg.query(
          `INSERT INTO planned_expenses
            (period_id, template_id, name, amount, paid, entry_type, due_day, category)
           VALUES ($1, $2, $3, $4, false, 'planned', $5, $6)
           RETURNING *`,
          [periodId, tpl.id, displayName, amount, tpl.due_day, tpl.category ?? null],
        );
        created.push(mapItemRow(ins.rows[0]));
        await ensureCategory(app, period.space_id, tpl.category ?? null);
      }
    }

    return reply.status(200).send({ created: created.length, skipped, reset, items: created });
  });

  app.put('/budget/items/:itemId', { preHandler: [app.authenticate] }, async (request) => {
    const { itemId } = request.params as { itemId: string };
    const userId = request.user.sub;
    const body = updateItemSchema.parse(request.body);

    await assertItemOwner(app, itemId, userId);

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(body.name);
    }
    if (body.amount !== undefined) {
      sets.push(`amount = $${idx++}`);
      values.push(body.amount);
    }
    if (body.paid !== undefined) {
      sets.push(`paid = $${idx++}`);
      values.push(body.paid);
    }
    if (body.entryType !== undefined) {
      sets.push(`entry_type = $${idx++}`);
      values.push(body.entryType);
    }
    if (body.dueDay !== undefined) {
      sets.push(`due_day = $${idx++}`);
      values.push(body.dueDay ?? null);
    }
    if (body.category !== undefined) {
      sets.push(`category = $${idx++}`);
      values.push(body.category?.trim() || null);
    }

    if (sets.length === 0) throw new BadRequestError('No fields to update');

    sets.push('updated_at = now()');
    values.push(itemId);

    const updated = await app.pg.query(
      `UPDATE planned_expenses SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );

    if (updated.rows.length === 0) throw new NotFoundError('Item not found');

    // If category changed and item is template-linked, propagate to the template so future periods use it.
    if (body.category !== undefined) {
      const row = updated.rows[0];
      const newCat = body.category?.trim() || null;
      if (row.template_id) {
        await app.pg.query(
          'UPDATE expense_templates SET category = $1, updated_at = now() WHERE id = $2',
          [newCat, row.template_id],
        );
      }
      // Ensure the category exists for the space (so it appears in lists/UI).
      const periodRow = await app.pg.query('SELECT space_id FROM budget_periods WHERE id = $1', [row.period_id]);
      if (periodRow.rows.length > 0 && newCat) {
        await ensureCategory(app, periodRow.rows[0].space_id as string, newCat);
      }
    }

    return mapItemRow(updated.rows[0]);
  });

  app.delete('/budget/items/:itemId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { itemId } = request.params as { itemId: string };
    const userId = request.user.sub;

    await assertItemOwner(app, itemId, userId);
    await app.pg.query('DELETE FROM planned_expenses WHERE id = $1', [itemId]);

    return reply.status(204).send();
  });

  app.post('/budget/items/:itemId/toggle-paid', { preHandler: [app.authenticate] }, async (request) => {
    const { itemId } = request.params as { itemId: string };
    const userId = request.user.sub;

    await assertItemOwner(app, itemId, userId);

    const updated = await app.pg.query(
      `UPDATE planned_expenses
       SET paid = NOT paid, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [itemId],
    );

    if (updated.rows.length === 0) throw new NotFoundError('Item not found');

    return mapItemRow(updated.rows[0]);
  });

  // ─── Monthly planning ────────────────────────────────────────────────────
  function mapMonthlyEntryRow(row: any) {
    return {
      id: row.id,
      year: row.year,
      month: row.month,
      kind: row.kind as 'income' | 'deduction',
      label: row.label,
      amount: Number(row.amount),
      recurring: row.recurring === true,
      sortOrder: row.sort_order,
      libraryDeductionId: row.library_deduction_id ?? null,
      subjectToDeductions: row.subject_to_deductions !== false,
      amountOverridden: row.amount_overridden === true,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  app.get('/budget/monthly', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const q = request.query as { year?: string; month?: string };
    const now = new Date();
    const year = q.year ? Number(q.year) : now.getUTCFullYear();
    const month = q.month ? Number(q.month) : now.getUTCMonth() + 1;

    // Auto-copy recurring entries from the previous month if this month has none yet.
    const existing = await app.pg.query(
      'SELECT count(*)::int AS n FROM monthly_entries WHERE user_id = $1 AND year = $2 AND month = $3',
      [userId, year, month],
    );
    if (existing.rows[0].n === 0) {
      const prevDate = new Date(Date.UTC(year, month - 2, 1));
      const py = prevDate.getUTCFullYear();
      const pm = prevDate.getUTCMonth() + 1;
      await app.pg.query(
        `INSERT INTO monthly_entries (user_id, year, month, kind, label, amount, recurring, sort_order, library_deduction_id, subject_to_deductions, amount_overridden)
         SELECT user_id, $4, $5, kind, label, amount, recurring, sort_order, library_deduction_id, subject_to_deductions, false
         FROM monthly_entries
         WHERE user_id = $1 AND year = $2 AND month = $3 AND recurring = true`,
        [userId, py, pm, year, month],
      );
    }

    const entries = await app.pg.query(
      `SELECT * FROM monthly_entries
       WHERE user_id = $1 AND year = $2 AND month = $3
       ORDER BY kind ASC, sort_order ASC, created_at ASC`,
      [userId, year, month],
    );

    // Spaces flagged for monthly planning, with each one's totals for this month in CRC.
    const spaces = await app.pg.query(
      `SELECT DISTINCT bs.*, u.name AS owner_name, lower(bs.name) AS sort_name
       FROM budget_spaces bs
       JOIN users u ON u.id = bs.owner_user_id
       LEFT JOIN budget_space_members bsm ON bsm.space_id = bs.id
       WHERE bs.include_in_monthly = true
         AND (bs.owner_user_id = $1 OR bsm.user_id = $1)
       ORDER BY sort_name ASC`,
      [userId],
    );

    const spaceRows: any[] = [];
    let expenseTotal = 0;
    for (const row of spaces.rows) {
      const rate = row.exchange_rate !== null && row.exchange_rate !== undefined ? Number(row.exchange_rate) : 540;
      // Match what the space card shows: only the current period's total for this month.
      // Falls back to any period in the month if no current is set.
      const stats = await app.pg.query(
        `SELECT coalesce(sum(CASE WHEN pe.amount < 6000 THEN pe.amount * $4 ELSE pe.amount END), 0) AS total
         FROM planned_expenses pe
         JOIN budget_periods bp ON bp.id = pe.period_id
         WHERE bp.space_id = $1
           AND bp.year = $2 AND bp.month = $3
           AND NOT (bp.year = 2100 AND bp.month = 12 AND bp.label = 'Future purchases')
           AND (
             bp.is_current = true
             OR NOT EXISTS (
               SELECT 1 FROM budget_periods bp2
               WHERE bp2.space_id = $1 AND bp2.year = $2 AND bp2.month = $3 AND bp2.is_current = true
             )
           )`,
        [row.id, year, month, rate],
      );
      const total = Number(stats.rows[0].total);
      expenseTotal += total;

      // Items belonging to that same period, so the Monthly page can show
      // the breakdown of each space without a second roundtrip.
      const itemsRes = await app.pg.query(
        `SELECT pe.id, pe.name, pe.amount, pe.paid, pe.category, pe.due_day,
                (CASE WHEN pe.amount < 6000 THEN pe.amount * $4 ELSE pe.amount END) AS amount_crc
           FROM planned_expenses pe
           JOIN budget_periods bp ON bp.id = pe.period_id
          WHERE bp.space_id = $1
            AND bp.year = $2 AND bp.month = $3
            AND NOT (bp.year = 2100 AND bp.month = 12 AND bp.label = 'Future purchases')
            AND (
              bp.is_current = true
              OR NOT EXISTS (
                SELECT 1 FROM budget_periods bp2
                WHERE bp2.space_id = $1 AND bp2.year = $2 AND bp2.month = $3 AND bp2.is_current = true
              )
            )
          ORDER BY pe.paid ASC, pe.due_day ASC NULLS LAST, lower(pe.name) ASC`,
        [row.id, year, month, rate],
      );
      const items = itemsRes.rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        amount: Number(r.amount),
        amountCrc: Number(r.amount_crc),
        paid: r.paid === true,
        category: r.category ?? null,
        dueDay: r.due_day ?? null,
      }));

      spaceRows.push({
        ...mapSpaceRow(row, userId),
        monthTotal: total,
        items,
      });
    }

    let incomeTotal = 0;
    let incomeSubjectTotal = 0;
    let deductionTotal = 0;
    for (const e of entries.rows) {
      const amt = Number(e.amount);
      if (e.kind === 'income') {
        incomeTotal += amt;
        if (e.subject_to_deductions !== false) incomeSubjectTotal += amt;
      } else {
        deductionTotal += amt;
      }
    }

    // Recompute amounts for any deduction entries linked to a library deduction,
    // so percentage/progressive/garnishment lines always reflect the current month's income.
    const linkedIds = Array.from(
      new Set(
        entries.rows
          .filter((e: any) => e.kind === 'deduction' && e.library_deduction_id && e.amount_overridden !== true)
          .map((e: any) => e.library_deduction_id as string),
      ),
    );
    const recomputed = new Map<string, number>(); // entry.id -> new amount
    const libMetaMap = new Map<string, any>();
    if (linkedIds.length > 0) {
      const libRes = await app.pg.query(
        `SELECT id, kind, rate, amount, brackets, config, affects_garnishment_base
           FROM payroll_deductions
          WHERE user_id = $1 AND id = ANY($2::uuid[])`,
        [userId, linkedIds],
      );
      for (const r of libRes.rows) libMetaMap.set(r.id, r);
    }
    if (linkedIds.length > 0 && incomeSubjectTotal > 0) {
      const libMap = libMetaMap;

      // Pass 1: non-garnishment.
      let preTotalForGarnishment = 0;
      const nonGarnEntries: Array<{ entryId: string; amount: number }> = [];
      const garnEntries: Array<{ entryId: string; lib: any }> = [];
      for (const e of entries.rows) {
        if (e.kind !== 'deduction' || !e.library_deduction_id) continue;
        if (e.amount_overridden === true) continue;
        const lib = libMap.get(e.library_deduction_id);
        if (!lib) continue;
        if (lib.kind === 'garnishment') {
          garnEntries.push({ entryId: e.id, lib });
          continue;
        }
        let amt = 0;
        if (lib.kind === 'percentage') amt = incomeSubjectTotal * Number(lib.rate ?? 0);
        else if (lib.kind === 'fixed') amt = Number(lib.amount ?? 0);
        else if (lib.kind === 'progressive') amt = calcProgressive(incomeSubjectTotal, lib.brackets ?? []);
        amt = Math.round(amt * 100) / 100;
        recomputed.set(e.id, amt);
        if (lib.affects_garnishment_base) preTotalForGarnishment += amt;
        nonGarnEntries.push({ entryId: e.id, amount: amt });
      }

      // Custom (non-library) deductions are NOT statutory and do not reduce the
      // judicial garnishment base.
      const netForGarnishment = Math.max(0, incomeSubjectTotal - preTotalForGarnishment);

      // Pass 2: garnishment.
      for (const g of garnEntries) {
        const cfg = g.lib.config;
        if (!cfg) continue;
        const { total } = calcGarnishment(netForGarnishment, cfg);
        const amt = Math.round(total * 100) / 100;
        recomputed.set(g.entryId, amt);
      }

      // Recalculate deductionTotal using the recomputed amounts.
      deductionTotal = 0;
      for (const e of entries.rows) {
        if (e.kind !== 'deduction') continue;
        const v = recomputed.has(e.id) ? recomputed.get(e.id)! : Number(e.amount);
        deductionTotal += v;
      }
    }

    return {
      year,
      month,
      entries: entries.rows.map((row: any) => {
        const mapped = mapMonthlyEntryRow(row);
        if (recomputed.has(row.id)) {
          mapped.amount = recomputed.get(row.id)!;
        }
        // Expose linked-library metadata so the UI can show "%", "progressive",
        // "garnishment" labels alongside the amount.
        let libraryKind: string | null = null;
        let libraryRate: number | null = null;
        if (row.library_deduction_id && libMetaMap.has(row.library_deduction_id)) {
          const lib = libMetaMap.get(row.library_deduction_id);
          libraryKind = lib.kind ?? null;
          libraryRate = lib.rate !== null && lib.rate !== undefined ? Number(lib.rate) : null;
        }
        return { ...mapped, libraryKind, libraryRate };
      }),
      spaces: spaceRows,
      summary: {
        incomeTotal,
        deductionTotal,
        expenseTotal,
        leftover: incomeTotal - deductionTotal - expenseTotal,
      },
    };
  });

  app.post('/budget/monthly/entries', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const body = monthlyEntrySchema.parse(request.body);

    const max = await app.pg.query(
      'SELECT coalesce(max(sort_order), 0) AS m FROM monthly_entries WHERE user_id = $1 AND year = $2 AND month = $3 AND kind = $4',
      [userId, body.year, body.month, body.kind],
    );
    const sortOrder = Number(max.rows[0].m) + 1;

    const inserted = await app.pg.query(
      `INSERT INTO monthly_entries (user_id, year, month, kind, label, amount, recurring, sort_order, library_deduction_id, subject_to_deductions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        userId,
        body.year,
        body.month,
        body.kind,
        body.label,
        body.amount,
        body.recurring ?? false,
        sortOrder,
        body.libraryDeductionId ?? null,
        body.subjectToDeductions ?? true,
      ],
    );
    return reply.status(201).send(mapMonthlyEntryRow(inserted.rows[0]));
  });

  app.put('/budget/monthly/entries/:id', { preHandler: [app.authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    const userId = request.user.sub;
    const body = updateMonthlyEntrySchema.parse(request.body);

    // Look up the row first so we can decide whether an amount edit should
    // mark the entry as user-overridden (so the GET recompute stops clobbering
    // it). Only library-linked deduction entries are affected by recompute.
    const existing = await app.pg.query(
      'SELECT kind, library_deduction_id FROM monthly_entries WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    if (existing.rows.length === 0) throw new NotFoundError('Entry not found');
    const existingRow = existing.rows[0];
    const isLibraryLinkedDeduction =
      existingRow.kind === 'deduction' && existingRow.library_deduction_id;

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (body.label !== undefined) { sets.push(`label = $${idx++}`); values.push(body.label); }
    if (body.amount !== undefined) {
      sets.push(`amount = $${idx++}`); values.push(body.amount);
      // Editing the amount on a library-linked deduction implies the user wants
      // to override the auto-computed value. Only flip on if not explicitly set
      // in the same request.
      if (isLibraryLinkedDeduction && body.amountOverridden === undefined) {
        sets.push(`amount_overridden = $${idx++}`); values.push(true);
      }
    }
    if (body.recurring !== undefined) { sets.push(`recurring = $${idx++}`); values.push(body.recurring); }
    if (body.subjectToDeductions !== undefined) {
      sets.push(`subject_to_deductions = $${idx++}`); values.push(body.subjectToDeductions);
    }
    if (body.amountOverridden !== undefined) {
      sets.push(`amount_overridden = $${idx++}`); values.push(body.amountOverridden);
    }
    if (sets.length === 0) throw new BadRequestError('No fields to update');
    sets.push('updated_at = now()');
    values.push(id, userId);

    const result = await app.pg.query(
      `UPDATE monthly_entries SET ${sets.join(', ')} WHERE id = $${idx++} AND user_id = $${idx} RETURNING *`,
      values,
    );
    if (result.rows.length === 0) throw new NotFoundError('Entry not found');
    return mapMonthlyEntryRow(result.rows[0]);
  });

  app.delete('/budget/monthly/entries/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user.sub;
    const result = await app.pg.query(
      'DELETE FROM monthly_entries WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    if (result.rowCount === 0) throw new NotFoundError('Entry not found');
    return reply.status(204).send();
  });

  // ─── Monthly snapshots ───────────────────────────────────────────────────
  // Take a snapshot of the monthly planning page for a given (year, month).
  // Stores the full payload (entries + spaces + summary) so historical reports
  // remain stable even after entries/spaces are later edited or deleted.
  async function takeSnapshot(userId: string, year: number, month: number, auto: boolean, payload: any) {
    const summary = payload?.summary ?? { incomeTotal: 0, deductionTotal: 0, expenseTotal: 0, leftover: 0 };
    const inserted = await app.pg.query(
      `INSERT INTO monthly_snapshots (user_id, year, month, income_total, deduction_total, expense_total, leftover, payload, auto)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       RETURNING id, year, month, income_total, deduction_total, expense_total, leftover, auto, created_at`,
      [userId, year, month, summary.incomeTotal, summary.deductionTotal, summary.expenseTotal, summary.leftover, JSON.stringify(payload), auto],
    );
    const r = inserted.rows[0];
    return {
      id: r.id,
      year: r.year,
      month: r.month,
      incomeTotal: Number(r.income_total),
      deductionTotal: Number(r.deduction_total),
      expenseTotal: Number(r.expense_total),
      leftover: Number(r.leftover),
      auto: r.auto === true,
      createdAt: r.created_at,
    };
  }

  app.post('/budget/monthly/snapshot', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const body = z.object({
      year: z.coerce.number().int().min(2000).max(2100),
      month: z.coerce.number().int().min(1).max(12),
      payload: z.any(),
      auto: z.boolean().optional(),
      onceForMonth: z.boolean().optional(),
    }).parse(request.body);
    // onceForMonth: skip if any snapshot already exists for this user+period.
    // Used by the client-side auto-on-last-day flow so we don't duplicate.
    if (body.onceForMonth) {
      const exists = await app.pg.query(
        `SELECT 1 FROM monthly_snapshots WHERE user_id = $1 AND year = $2 AND month = $3 LIMIT 1`,
        [userId, body.year, body.month],
      );
      if (exists.rowCount && exists.rowCount > 0) {
        return reply.status(200).send({ skipped: true });
      }
    }
    const snap = await takeSnapshot(userId, body.year, body.month, body.auto === true, body.payload);
    return reply.status(201).send(snap);
  });

  app.get('/budget/monthly/snapshots', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const rows = await app.pg.query(
      `SELECT id, year, month, income_total, deduction_total, expense_total, leftover, auto, created_at
         FROM monthly_snapshots
        WHERE user_id = $1
        ORDER BY year DESC, month DESC, created_at DESC`,
      [userId],
    );
    return rows.rows.map((r: any) => ({
      id: r.id,
      year: r.year,
      month: r.month,
      incomeTotal: Number(r.income_total),
      deductionTotal: Number(r.deduction_total),
      expenseTotal: Number(r.expense_total),
      leftover: Number(r.leftover),
      auto: r.auto === true,
      createdAt: r.created_at,
    }));
  });

  app.get('/budget/monthly/snapshots/:id', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const res = await app.pg.query(
      `SELECT id, year, month, income_total, deduction_total, expense_total, leftover, auto, created_at, payload
         FROM monthly_snapshots
        WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (res.rows.length === 0) throw new NotFoundError('Snapshot not found');
    const r = res.rows[0];
    return {
      id: r.id,
      year: r.year,
      month: r.month,
      incomeTotal: Number(r.income_total),
      deductionTotal: Number(r.deduction_total),
      expenseTotal: Number(r.expense_total),
      leftover: Number(r.leftover),
      auto: r.auto === true,
      createdAt: r.created_at,
      payload: r.payload,
    };
  });

  app.delete('/budget/monthly/snapshots/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const del = await app.pg.query(
      `DELETE FROM monthly_snapshots WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (del.rowCount === 0) throw new NotFoundError('Snapshot not found');
    return reply.status(204).send();
  });
}
