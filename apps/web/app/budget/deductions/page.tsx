'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2, Calculator, Sparkles } from 'lucide-react';
import AuthShell from '@/components/layout/AuthShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { api } from '@/lib/api-client';

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
  base: number;
  amount: number;
}

interface Deduction {
  id: string;
  name: string;
  kind: Kind;
  rate: number | null;
  amount: number | null;
  brackets: Bracket[] | null;
  config: GarnishmentConfig | null;
  active: boolean;
  affectsGarnishmentBase: boolean;
  sortOrder: number;
}

interface CalcResultItem {
  id: string;
  name: string;
  kind: Kind;
  amount: number;
  config: GarnishmentConfig | null;
  ranges: GarnishmentRange[] | null;
}

interface CalcResult {
  gross: number;
  deductions: CalcResultItem[];
  preGarnishmentTotal: number;
  netBeforeGarnishment: number;
  garnishmentTotal: number;
  totalDeductions: number;
  net: number;
}

function formatCRC(n: number): string {
  return `₡${Math.round(n).toLocaleString('en-US')}`;
}

function formatPct(r: number): string {
  return `${(r * 100).toFixed(2).replace(/\.00$/, '')}%`;
}

export default function DeductionsLibraryPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [gross, setGross] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<CalcResult | null>(null);
  const [editing, setEditing] = useState<Deduction | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api<Deduction[]>('/payroll/deductions');
      setDeductions(rows);
      setSelected((prev) => {
        const next: Record<string, boolean> = {};
        for (const d of rows) next[d.id] = prev[d.id] ?? d.active;
        return next;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function seedDefaults() {
    await api('/payroll/deductions/seed-defaults', { method: 'POST' });
    await load();
  }

  async function calculate() {
    const grossNum = Number(gross);
    if (!Number.isFinite(grossNum) || grossNum < 0) return;
    const ids = Object.entries(selected).filter(([, on]) => on).map(([id]) => id);
    const res = await api<CalcResult>('/payroll/calculate', {
      method: 'POST',
      body: {
        gross: grossNum,
        deductionIds: ids,
      },
    });
    setResult(res);
  }

  async function deleteDeduction(id: string) {
    if (!window.confirm('Delete this deduction from your library?')) return;
    await api(`/payroll/deductions/${id}`, { method: 'DELETE' });
    if (editing?.id === id) setEditing(null);
    await load();
  }

  const grossNum = useMemo(() => {
    const n = Number(gross);
    return Number.isFinite(n) ? n : 0;
  }, [gross]);

  // Two-pass net-before-garnishment preview using currently selected deductions.
  // This drives the per-row preview for garnishment rows.
  const previewNetBeforeGarnishment = useMemo(() => {
    let total = 0;
    for (const d of deductions) {
      if (!selected[d.id]) continue;
      if (d.kind === 'garnishment') continue;
      if (!d.affectsGarnishmentBase) continue;
      if (d.kind === 'percentage') total += grossNum * (d.rate ?? 0);
      else if (d.kind === 'fixed') total += d.amount ?? 0;
      else if (d.kind === 'progressive') total += calcProgressive(grossNum, d.brackets ?? []);
    }
    return Math.max(0, grossNum - total);
  }, [deductions, selected, grossNum]);

  // Live preview each row's computed amount (without hitting the API).
  function previewAmount(d: Deduction): number {
    if (d.kind === 'percentage') return grossNum * (d.rate ?? 0);
    if (d.kind === 'fixed') return d.amount ?? 0;
    if (d.kind === 'progressive') return calcProgressive(grossNum, d.brackets ?? []);
    if (d.kind === 'garnishment' && d.config)
      return calcGarnishment(previewNetBeforeGarnishment, d.config).total;
    return 0;
  }

  return (
    <AuthShell>
      <div className={`mx-auto max-w-2xl ${isMobile ? 'px-4 pb-24 pt-3' : 'px-6 py-6'}`}>
        <div className="mb-4 flex items-center justify-between">
          <button className="z-btn z-btn-sm" onClick={() => router.back()}>← Back</button>
          <button className="z-btn z-btn-sm inline-flex items-center gap-1" onClick={() => setCreating(true)}>
            <Plus size={12} /> New deduction
          </button>
        </div>

        <h1 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--ink-text)' }}>Deductions</h1>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-text-muted)' }}>
          Your library of recurring deductions. Pick them inside Monthly Planning to apply against your income.
        </p>

        {/* Gross input */}
        <section
          className="mt-4 rounded-2xl border p-4"
          style={{ borderColor: 'var(--ink-border-subtle)', background: 'var(--ink-surface)', boxShadow: 'var(--ink-shadow-sm)' }}
        >
          <label className="z-label">Gross salary (CRC)</label>
          <input
            className="z-input mt-1"
            inputMode="decimal"
            value={gross}
            onChange={(e) => setGross(e.target.value)}
            placeholder="e.g. 2,884,000"
          />
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
              {Object.values(selected).filter(Boolean).length} deduction(s) selected
            </p>
            <button className="z-btn z-btn-primary inline-flex items-center gap-1" onClick={calculate} disabled={!gross}>
              <Calculator size={12} /> Calculate
            </button>
          </div>
        </section>

        {/* Result */}
        {result && (
          <section
            className="mt-4 rounded-2xl border p-4"
            style={{ borderColor: 'var(--ink-border-subtle)', background: 'var(--ink-surface)', boxShadow: 'var(--ink-shadow-sm)' }}
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <span style={{ color: 'var(--ink-text-secondary)' }}>Gross</span>
              <span className="text-right tabular-nums" style={{ color: 'var(--ink-text)' }}>{formatCRC(result.gross)}</span>
              {result.deductions.filter((d) => d.kind !== 'garnishment').map((d) => (
                <ResultLine key={d.id} name={d.name} amount={d.amount} />
              ))}
              {result.deductions.some((d) => d.kind === 'garnishment') && (
                <>
                  <span className="font-medium" style={{ color: 'var(--ink-text)' }}>= Net before garnishment</span>
                  <span className="text-right font-medium tabular-nums" style={{ color: 'var(--ink-text)' }}>{formatCRC(result.netBeforeGarnishment)}</span>
                  {result.deductions.filter((d) => d.kind === 'garnishment').map((d) => (
                    <ResultLine key={d.id} name={d.name} amount={d.amount} />
                  ))}
                </>
              )}
              <span className="font-medium" style={{ color: 'var(--ink-text)' }}>− Total deductions</span>
              <span className="text-right font-medium tabular-nums" style={{ color: 'var(--ink-text)' }}>{formatCRC(result.totalDeductions)}</span>
            </div>
            <div className="mt-3 flex items-baseline justify-between border-t pt-3" style={{ borderColor: 'var(--ink-border-subtle)' }}>
              <span className="text-sm font-medium" style={{ color: 'var(--ink-text)' }}>Net pay</span>
              <span
                className="text-lg font-semibold tabular-nums"
                style={{ color: result.net >= 0 ? 'var(--ink-text)' : '#dc2626' }}
              >
                {formatCRC(result.net)}
              </span>
            </div>

            {/* Garnishment range breakdown */}
            {result.deductions.filter((d) => d.kind === 'garnishment' && d.ranges).map((d) => (
              <div key={`g-${d.id}`} className="mt-4 border-t pt-3" style={{ borderColor: 'var(--ink-border-subtle)' }}>
                <p className="mb-1.5 text-xs font-medium" style={{ color: 'var(--ink-text-secondary)' }}>
                  {d.name} — range breakdown
                </p>
                <div className="space-y-1 text-xs">
                  {d.ranges!.map((r, i) => (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <span className="truncate" style={{ color: 'var(--ink-text-muted)' }}>
                        {r.label} · {formatPct(r.rate)}
                      </span>
                      <span className="tabular-nums" style={{ color: 'var(--ink-text)' }}>
                        {formatCRC(r.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Library */}
        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium" style={{ color: 'var(--ink-text-secondary)' }}>Deduction library</h2>
            <button
              className="z-btn z-btn-sm inline-flex items-center gap-1"
              onClick={seedDefaults}
              title="Re-add any missing Costa Rica default deductions (CCSS, Renta, Embargo, …). Existing items are not changed."
            >
              <Sparkles size={12} /> Seed CR defaults
            </button>
          </div>

          {loading && deductions.length === 0 && (
            <p className="px-1 py-3 text-xs" style={{ color: 'var(--ink-text-muted)' }}>Loading…</p>
          )}

          {!loading && deductions.length === 0 && (
            <div
              className="rounded-2xl border px-4 py-6 text-center"
              style={{ borderColor: 'var(--ink-border-subtle)', background: 'var(--ink-surface)' }}
            >
              <p className="text-sm" style={{ color: 'var(--ink-text)' }}>Your deduction library is empty.</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--ink-text-muted)' }}>
                Seed the Costa Rica defaults (CCSS, ASEAKAMAI, Renta, …) or add your own.
              </p>
              <div className="mt-3 flex justify-center gap-2">
                <button className="z-btn z-btn-primary inline-flex items-center gap-1" onClick={seedDefaults}>
                  <Sparkles size={12} /> Seed defaults
                </button>
                <button className="z-btn inline-flex items-center gap-1" onClick={() => setCreating(true)}>
                  <Plus size={12} /> New
                </button>
              </div>
            </div>
          )}

          {deductions.length > 0 && (
            <div
              className="divide-y rounded-2xl border"
              style={{ borderColor: 'var(--ink-border-subtle)', background: 'var(--ink-surface)', boxShadow: 'var(--ink-shadow-sm)' }}
            >
              {deductions.map((d) => (
                <LibraryRow
                  key={d.id}
                  d={d}
                  checked={selected[d.id] ?? false}
                  onToggle={(v) => setSelected((p) => ({ ...p, [d.id]: v }))}
                  preview={previewAmount(d)}
                  onEdit={() => setEditing(d)}
                  onDelete={() => deleteDeduction(d.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {creating && (
        <DeductionEditor
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}
      {editing && (
        <DeductionEditor
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </AuthShell>
  );
}

function ResultLine({ name, amount }: { name: string; amount: number }) {
  return (
    <>
      <span style={{ color: 'var(--ink-text-secondary)' }}>− {name}</span>
      <span className="text-right tabular-nums" style={{ color: 'var(--ink-text)' }}>{formatCRC(amount)}</span>
    </>
  );
}

function LibraryRow({
  d,
  checked,
  onToggle,
  preview,
  onEdit,
  onDelete,
}: {
  d: Deduction;
  checked: boolean;
  onToggle: (v: boolean) => void;
  preview: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const subtitle =
    d.kind === 'percentage'
      ? `${formatPct(d.rate ?? 0)} of gross`
      : d.kind === 'fixed'
        ? `Fixed ${formatCRC(d.amount ?? 0)}`
        : d.kind === 'progressive'
          ? `Progressive · ${d.brackets?.length ?? 0} brackets`
          : `Garnishment · min ${formatCRC(d.config?.minimumSalary ?? 0)} · ${formatPct(d.config?.midRate ?? 0)}/${formatPct(d.config?.topRate ?? 0)}`;

  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        aria-label={`Include ${d.name}`}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm" style={{ color: 'var(--ink-text)' }}>
          {d.name?.trim() ? d.name : <span style={{ color: 'var(--ink-text-faint)' }}>(unnamed)</span>}
        </p>
        <p className="truncate text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>{subtitle}</p>
      </div>
      <span className="w-20 shrink-0 text-right text-sm tabular-nums sm:w-28" style={{ color: 'var(--ink-text-secondary)' }}>
        {formatCRC(preview)}
      </span>
      <button className="z-btn z-btn-sm shrink-0" onClick={onEdit} aria-label="Edit">
        <Pencil size={12} />
      </button>
      <button className="z-btn z-btn-sm shrink-0 text-red-600" onClick={onDelete} aria-label="Delete">
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function calcProgressive(gross: number, brackets: Bracket[]): number {
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

function calcGarnishment(net: number, cfg: GarnishmentConfig): { total: number; ranges: GarnishmentRange[] } {
  const min = cfg.minimumSalary;
  const protectedCap = min * cfg.protectedMultiplier;
  const upperCap = min * cfg.upperMultiplier;
  const protectedBase = Math.max(0, Math.min(net, protectedCap));
  const midBase = Math.max(0, Math.min(net, upperCap) - protectedCap);
  const topBase = Math.max(0, net - upperCap);
  const midAmount = midBase * cfg.midRate;
  const topAmount = topBase * cfg.topRate;
  const ranges: GarnishmentRange[] = [
    { label: `\u20A1${formatNum(0)} to \u20A1${formatNum(protectedCap)} (protected)`, from: 0, to: protectedCap, rate: 0, base: protectedBase, amount: 0 },
    { label: `\u20A1${formatNum(protectedCap)} to \u20A1${formatNum(upperCap)}`, from: protectedCap, to: upperCap, rate: cfg.midRate, base: midBase, amount: midAmount },
    { label: `\u20A1${formatNum(upperCap)} and above`, from: upperCap, to: null, rate: cfg.topRate, base: topBase, amount: topAmount },
  ];
  return { total: midAmount + topAmount, ranges };
}

function formatNum(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

function DeductionEditor({
  existing,
  onClose,
  onSaved,
}: {
  existing?: Deduction;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const isEdit = !!existing;
  const [name, setName] = useState(existing?.name ?? '');
  const [kind, setKind] = useState<Kind>(existing?.kind ?? 'percentage');
  const [active, setActive] = useState(existing?.active ?? true);
  const [affectsBase, setAffectsBase] = useState(existing?.affectsGarnishmentBase ?? false);
  const [ratePct, setRatePct] = useState(
    existing?.kind === 'percentage' && existing.rate != null ? (existing.rate * 100).toString() : '',
  );
  const [amount, setAmount] = useState(
    existing?.kind === 'fixed' && existing.amount != null ? existing.amount.toString() : '',
  );
  const [brackets, setBrackets] = useState<Array<{ min: string; max: string; ratePct: string }>>(
    existing?.kind === 'progressive' && existing.brackets
      ? existing.brackets.map((b) => ({
          min: b.min.toString(),
          max: b.max == null ? '' : b.max.toString(),
          ratePct: (b.rate * 100).toString(),
        }))
      : [
          { min: '0', max: '918000', ratePct: '0' },
          { min: '918000', max: '1347000', ratePct: '10' },
          { min: '1347000', max: '2364000', ratePct: '15' },
          { min: '2364000', max: '4727000', ratePct: '20' },
          { min: '4727000', max: '', ratePct: '25' },
        ],
  );
  const [minSalary, setMinSalary] = useState(
    existing?.kind === 'garnishment' && existing.config
      ? existing.config.minimumSalary.toString()
      : '268731.31',
  );
  const [protectedMult, setProtectedMult] = useState(
    existing?.kind === 'garnishment' && existing.config
      ? existing.config.protectedMultiplier.toString()
      : '1',
  );
  const [upperMult, setUpperMult] = useState(
    existing?.kind === 'garnishment' && existing.config
      ? existing.config.upperMultiplier.toString()
      : '4',
  );
  const [midRatePct, setMidRatePct] = useState(
    existing?.kind === 'garnishment' && existing.config
      ? (existing.config.midRate * 100).toString()
      : '12.5',
  );
  const [topRatePct, setTopRatePct] = useState(
    existing?.kind === 'garnishment' && existing.config
      ? (existing.config.topRate * 100).toString()
      : '25',
  );
  const [saving, setSaving] = useState(false);

  function addBracket() {
    const last = brackets[brackets.length - 1];
    const prevMax = last?.max ? Number(last.max) : 0;
    setBrackets([...brackets, { min: prevMax ? String(prevMax) : '', max: '', ratePct: '0' }]);
  }
  function updateBracket(i: number, patch: Partial<{ min: string; max: string; ratePct: string }>) {
    setBrackets((bs) => bs.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function removeBracket(i: number) {
    setBrackets((bs) => bs.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const buildConfig = () => ({
        minimumSalary: Number(minSalary),
        protectedMultiplier: Number(protectedMult),
        upperMultiplier: Number(upperMult),
        midRate: Number(midRatePct) / 100,
        topRate: Number(topRatePct) / 100,
      });
      if (isEdit) {
        // Kind is immutable on edit (server enforces). Only send the matching field.
        const body: Record<string, unknown> = { name: name.trim(), active };
        if (existing!.kind !== 'garnishment') body.affectsGarnishmentBase = affectsBase;
        if (existing!.kind === 'percentage') body.rate = Number(ratePct) / 100;
        if (existing!.kind === 'fixed') body.amount = Number(amount);
        if (existing!.kind === 'progressive') {
          body.brackets = brackets.map((b) => ({
            min: Number(b.min),
            max: b.max === '' ? null : Number(b.max),
            rate: Number(b.ratePct) / 100,
          }));
        }
        if (existing!.kind === 'garnishment') body.config = buildConfig();
        await api(`/payroll/deductions/${existing!.id}`, { method: 'PUT', body });
      } else {
        const body: Record<string, unknown> = { name: name.trim(), kind, active };
        if (kind !== 'garnishment') body.affectsGarnishmentBase = affectsBase;
        if (kind === 'percentage') body.rate = Number(ratePct) / 100;
        if (kind === 'fixed') body.amount = Number(amount);
        if (kind === 'progressive') {
          body.brackets = brackets.map((b) => ({
            min: Number(b.min),
            max: b.max === '' ? null : Number(b.max),
            rate: Number(b.ratePct) / 100,
          }));
        }
        if (kind === 'garnishment') body.config = buildConfig();
        await api('/payroll/deductions', { method: 'POST', body });
      }
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'var(--ink-overlay)' }}
      onClick={onClose}
    >
      <div className="z-overlay z-animate-in w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-base font-semibold">{isEdit ? 'Edit deduction' : 'New deduction'}</h2>
        <div className="space-y-3">
          <div>
            <label className="z-label">Name</label>
            <input className="z-input mt-1" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          <div>
            <label className="z-label">Type</label>
            <select
              className="z-input mt-1"
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
              disabled={isEdit}
            >
              <option value="percentage">Percentage of gross</option>
              <option value="fixed">Fixed amount</option>
              <option value="progressive">Progressive (marginal table)</option>
              <option value="garnishment">Garnishment (on net)</option>
            </select>
            {isEdit && (
              <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
                Type cannot be changed after creation.
              </p>
            )}
          </div>

          {kind === 'percentage' && (
            <div>
              <label className="z-label">Rate (%)</label>
              <input
                className="z-input mt-1"
                inputMode="decimal"
                value={ratePct}
                onChange={(e) => setRatePct(e.target.value)}
                placeholder="e.g. 9.83"
              />
            </div>
          )}

          {kind === 'fixed' && (
            <div>
              <label className="z-label">Amount (CRC)</label>
              <input
                className="z-input mt-1"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
            </div>
          )}

          {kind === 'progressive' && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="z-label">Brackets</label>
                <button className="z-btn z-btn-sm inline-flex items-center gap-1" onClick={addBracket}>
                  <Plus size={12} /> Add
                </button>
              </div>
              <div className="space-y-1.5">
                <div className="grid grid-cols-[1fr_1fr_80px_28px] gap-1.5 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-text-faint)' }}>
                  <span>Min</span>
                  <span>Max (blank = ∞)</span>
                  <span>Rate %</span>
                  <span></span>
                </div>
                {brackets.map((b, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_80px_28px] gap-1.5">
                    <input className="z-input" inputMode="decimal" value={b.min} onChange={(e) => updateBracket(i, { min: e.target.value })} />
                    <input className="z-input" inputMode="decimal" value={b.max} onChange={(e) => updateBracket(i, { max: e.target.value })} placeholder="∞" />
                    <input className="z-input" inputMode="decimal" value={b.ratePct} onChange={(e) => updateBracket(i, { ratePct: e.target.value })} />
                    <button className="z-btn z-btn-sm text-red-600" onClick={() => removeBracket(i)} aria-label="Remove bracket">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
                Tax is marginal: only the slice of gross within each bracket is taxed at that bracket's rate.
              </p>
            </div>
          )}

          {kind === 'garnishment' && (
            <div className="space-y-2">
              <div>
                <label className="z-label">Minimum non-garnishable salary (CRC)</label>
                <input className="z-input mt-1" inputMode="decimal" value={minSalary} onChange={(e) => setMinSalary(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="z-label">Protected multiplier (× min)</label>
                  <input className="z-input mt-1" inputMode="decimal" value={protectedMult} onChange={(e) => setProtectedMult(e.target.value)} />
                </div>
                <div>
                  <label className="z-label">Upper multiplier (× min)</label>
                  <input className="z-input mt-1" inputMode="decimal" value={upperMult} onChange={(e) => setUpperMult(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="z-label">Mid rate %</label>
                  <input className="z-input mt-1" inputMode="decimal" value={midRatePct} onChange={(e) => setMidRatePct(e.target.value)} />
                </div>
                <div>
                  <label className="z-label">Top rate %</label>
                  <input className="z-input mt-1" inputMode="decimal" value={topRatePct} onChange={(e) => setTopRatePct(e.target.value)} />
                </div>
              </div>
              <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
                Applied to net salary (gross minus non-garnishment deductions). 0% up to protected×min, mid% between protected×min and upper×min, top% above upper×min.
              </p>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (selected by default in calculator)
          </label>

          {kind !== 'garnishment' && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={affectsBase}
                onChange={(e) => setAffectsBase(e.target.checked)}
              />
              <span>
                Reduces judicial garnishment base
                <span className="block text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
                  Only enable for statutory deductions (CCSS, Operadora de Pensiones, Impuesto de Renta).
                </span>
              </span>
            </label>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button className="z-btn" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="z-btn z-btn-primary" onClick={save} disabled={saving || !name.trim()}>
              {saving ? 'Saving…' : isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
