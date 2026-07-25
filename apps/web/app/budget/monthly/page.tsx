'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/layout/AuthShell';
import BudgetSubNav from '@/components/budget/BudgetSubNav';
import { useIsMobile } from '@/lib/useIsMobile';
import { useBudgetStore } from '@/lib/useBudgetStore';
import { api } from '@/lib/api-client';
import { Camera, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Pencil, Plus, Trash2, X } from 'lucide-react';

interface MonthlyEntry {
  id: string;
  year: number;
  month: number;
  kind: 'income' | 'deduction';
  label: string;
  amount: number;
  recurring: boolean;
  sortOrder: number;
  libraryDeductionId: string | null;
  libraryKind: 'percentage' | 'fixed' | 'progressive' | 'garnishment' | null;
  libraryRate: number | null;
  subjectToDeductions: boolean;
  amountOverridden: boolean;
  payPeriod: 1 | 2 | null;
}

interface MonthlySpaceItem {
  id: string;
  name: string;
  amount: number;
  amountCrc: number;
  paid: boolean;
  category: string | null;
  dueDay: number | null;
}

interface MonthlySpace {
  id: string;
  name: string;
  cadence: string;
  monthTotal: number;
  items: MonthlySpaceItem[];
}

interface MonthlySummary {
  incomeTotal: number;
  deductionTotal: number;
  expenseTotal: number;
  leftover: number;
}

interface CashflowHalf {
  income: number;
  deduction: number;
  net: number;
  expensePaid: number;
  expensePlanned: number;
  expected: number;
  projected: number;
  actual: number | null;
  drift: number | null;
}

interface MonthlyCashflow {
  openingBalance: number | null;
  q1: CashflowHalf;
  q2: CashflowHalf;
}

interface MonthlyResponse {
  year: number;
  month: number;
  entries: MonthlyEntry[];
  spaces: MonthlySpace[];
  summary: MonthlySummary;
  cashflow: MonthlyCashflow;
}

type DeductionKind = 'percentage' | 'fixed' | 'progressive' | 'garnishment';

interface LibraryDeduction {
  id: string;
  name: string;
  kind: DeductionKind;
  rate: number | null;
  amount: number | null;
  active: boolean;
}

interface CalcItem {
  id: string;
  name: string;
  kind: DeductionKind;
  amount: number;
}

interface CalcResp {
  gross: number;
  deductions: CalcItem[];
  totalDeductions: number;
  net: number;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatCRC(n: number): string {
  return `₡${Math.round(n).toLocaleString('en-US')}`;
}

function formatSignedCRC(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}₡${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

function parseAmount(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export default function MonthlyPlanningPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<MonthlyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // Full space list (not just the ones already included) so we can surface
  // spaces that aren't showing up here yet — "include in monthly" used to be
  // a checkbox buried in each space's Edit modal, invisible from this page.
  const allSpaces = useBudgetStore((s) => s.spaces);
  const loadAllSpaces = useBudgetStore((s) => s.loadSpaces);
  const setIncludeInMonthly = useBudgetStore((s) => s.setIncludeInMonthly);
  const [togglingSpaceId, setTogglingSpaceId] = useState<string | null>(null);
  const [showExcludedSpaces, setShowExcludedSpaces] = useState(false);
  const [showAdd, setShowAdd] = useState<null | 'income' | 'deduction'>(null);
  const [addLabel, setAddLabel] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [addRecurring, setAddRecurring] = useState(true);
  const [editing, setEditing] = useState<MonthlyEntry | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editRecurring, setEditRecurring] = useState(false);
  const [editSubject, setEditSubject] = useState(true);
  const [addSubject, setAddSubject] = useState(true);
  const [addPayPeriod, setAddPayPeriod] = useState<1 | 2 | null>(null);
  const [editPayPeriod, setEditPayPeriod] = useState<1 | 2 | null>(null);
  const [pickerPayPeriod, setPickerPayPeriod] = useState<1 | 2 | null>(null);
  // Cash-flow reconciliation inputs (opening balance + actual bank balance per quincena).
  const [openingInput, setOpeningInput] = useState('');
  const [q1Input, setQ1Input] = useState('');
  const [q2Input, setQ2Input] = useState('');
  const [savingCashflow, setSavingCashflow] = useState(false);
  // Deduction picker (from library)
  const [pickerMode, setPickerMode] = useState<'library' | 'custom'>('library');
  const [library, setLibrary] = useState<LibraryDeduction[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [previewAmounts, setPreviewAmounts] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [submittingPicker, setSubmittingPicker] = useState(false);

  // What-if toggles: client-only flag per entry/space. When false, that row is
  // excluded from the previewed totals. Resets when the month changes.
  const [disabledEntries, setDisabledEntries] = useState<Record<string, boolean>>({});
  const [disabledSpaces, setDisabledSpaces] = useState<Record<string, boolean>>({});
  const [disabledItems, setDisabledItems] = useState<Record<string, boolean>>({});
  const [expandedSpaces, setExpandedSpaces] = useState<Record<string, boolean>>({});

  // Inline-edit state: entryId currently being edited inline (amount only).
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState('');

  // Snapshot
  const [snapshotting, setSnapshotting] = useState(false);
  const [snapshotMsg, setSnapshotMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<MonthlyResponse>(`/budget/monthly?year=${year}&month=${month}`);
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadAllSpaces(); }, [loadAllSpaces]);

  async function toggleSpaceInMonthly(spaceId: string, include: boolean) {
    setTogglingSpaceId(spaceId);
    try {
      await setIncludeInMonthly(spaceId, include);
      await load();
    } finally {
      setTogglingSpaceId(null);
    }
  }

  // Sync the cash-flow inputs whenever fresh data arrives so edits made
  // elsewhere (or a month switch) are reflected in the reconciliation fields.
  useEffect(() => {
    const cf = data?.cashflow;
    setOpeningInput(cf?.openingBalance != null ? String(cf.openingBalance) : '');
    setQ1Input(cf?.q1.actual != null ? String(cf.q1.actual) : '');
    setQ2Input(cf?.q2.actual != null ? String(cf.q2.actual) : '');
  }, [data]);

  // Auto-snapshot: when viewing the current month on its last calendar day,
  // post a once-per-month snapshot so reporting captures the final state.
  // The endpoint is idempotent via `onceForMonth`, so navigating in/out is safe.
  useEffect(() => {
    if (!data) return;
    const today = new Date();
    const isCurrent = today.getFullYear() === year && today.getMonth() + 1 === month;
    if (!isCurrent) return;
    const lastDay = new Date(year, month, 0).getDate();
    if (today.getDate() !== lastDay) return;
    api('/budget/monthly/snapshot', {
      method: 'POST',
      body: { year, month, payload: data, auto: true, onceForMonth: true },
    }).catch(() => { /* silent */ });
  }, [data, year, month]);

  // Resetting what-if toggles whenever the period changes so the user starts
  // fresh and isn't surprised by hidden disabled rows when navigating months.
  useEffect(() => {
    setDisabledEntries({});
    setDisabledSpaces({});
    setDisabledItems({});
    setExpandedSpaces({});
    setInlineEditId(null);
    setSnapshotMsg(null);
  }, [year, month]);

  function shiftMonth(delta: number) {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth() + 1);
  }

  async function addEntry() {
    if (!showAdd || !addLabel.trim()) return;
    const amt = Number(addAmount);
    if (!Number.isFinite(amt) || amt < 0) return;
    await api('/budget/monthly/entries', {
      method: 'POST',
      body: {
        year,
        month,
        kind: showAdd,
        label: addLabel.trim(),
        amount: amt,
        recurring: addRecurring,
        payPeriod: addPayPeriod,
        ...(showAdd === 'income' ? { subjectToDeductions: addSubject } : {}),
      },
    });
    setShowAdd(null);
    setAddLabel('');
    setAddAmount('');
    setAddRecurring(true);
    setAddSubject(true);
    setAddPayPeriod(null);
    await load();
  }

  function openEdit(entry: MonthlyEntry) {
    setEditing(entry);
    setEditLabel(entry.label);
    setEditAmount(String(entry.amount));
    setEditRecurring(entry.recurring);
    setEditSubject(entry.subjectToDeductions);
    setEditPayPeriod(entry.payPeriod);
  }

  async function saveEdit() {
    if (!editing) return;
    const amt = Number(editAmount);
    if (!Number.isFinite(amt) || amt < 0) return;
    await api(`/budget/monthly/entries/${editing.id}`, {
      method: 'PUT',
      body: {
        label: editLabel.trim(),
        amount: amt,
        recurring: editRecurring,
        payPeriod: editPayPeriod,
        ...(editing.kind === 'income' ? { subjectToDeductions: editSubject } : {}),
      },
    });
    setEditing(null);
    await load();
  }

  async function deleteEntry(id: string) {
    if (!window.confirm('Remove this entry?')) return;
    await api(`/budget/monthly/entries/${id}`, { method: 'DELETE' });
    if (editing?.id === id) setEditing(null);
    await load();
  }

  // Save just the amount inline (Enter or check button) without opening the modal.
  async function saveInlineAmount(entry: MonthlyEntry) {
    const amt = Number(inlineEditValue);
    if (!Number.isFinite(amt) || amt < 0) { setInlineEditId(null); return; }
    if (Math.round(amt * 100) === Math.round(entry.amount * 100)) { setInlineEditId(null); return; }
    await api(`/budget/monthly/entries/${entry.id}`, {
      method: 'PUT',
      body: { amount: amt },
    });
    setInlineEditId(null);
    await load();
  }

  // Clear a manual override on a library-linked deduction so the server
  // resumes auto-computing the amount from monthly income.
  async function recalculateEntry(entry: MonthlyEntry) {
    await api(`/budget/monthly/entries/${entry.id}`, {
      method: 'PUT',
      body: { amountOverridden: false },
    });
    await load();
  }

  // Quick-assign which quincena an entry hits the bank. Clicking the active
  // half again clears it back to "both" (null).
  async function setPayPeriod(entry: MonthlyEntry, pp: 1 | 2 | null) {
    const next = entry.payPeriod === pp ? null : pp;
    await api(`/budget/monthly/entries/${entry.id}`, {
      method: 'PUT',
      body: { payPeriod: next },
    });
    await load();
  }

  // Persist the bank-reconciliation inputs (opening + actual per quincena).
  async function saveCashflow(patch: { openingBalance?: number | null; actualQ1?: number | null; actualQ2?: number | null }) {
    setSavingCashflow(true);
    try {
      await api('/budget/monthly/cashflow', {
        method: 'PUT',
        body: { year, month, ...patch },
      });
      await load();
    } finally {
      setSavingCashflow(false);
    }
  }

  async function takeSnapshot() {
    if (!data) return;
    setSnapshotting(true);
    setSnapshotMsg(null);
    try {
      // We pass the data already on screen, so the snapshot matches what the
      // user sees right now (after any inline edits and on the server's recompute).
      await api('/budget/monthly/snapshot', {
        method: 'POST',
        body: { year, month, payload: data },
      });
      setSnapshotMsg('Snapshot saved');
      window.setTimeout(() => setSnapshotMsg(null), 3000);
    } catch (err: any) {
      setSnapshotMsg(err?.message ?? 'Failed to snapshot');
    } finally {
      setSnapshotting(false);
    }
  }

  const incomes = useMemo(() => data?.entries.filter((e) => e.kind === 'income') ?? [], [data]);
  const deductions = useMemo(() => data?.entries.filter((e) => e.kind === 'deduction') ?? [], [data]);
  const incomeTotal = data?.summary.incomeTotal ?? 0;
  // Only incomes flagged as subject to deductions feed into payroll calc.
  const incomeSubjectTotal = useMemo(
    () => incomes.reduce((s, e) => s + (e.subjectToDeductions !== false ? e.amount : 0), 0),
    [incomes],
  );
  const linkedLibraryIds = useMemo(
    () => new Set(deductions.map((d) => d.libraryDeductionId).filter((v): v is string => !!v)),
    [deductions],
  );

  // Spaces that exist but aren't feeding into this month's totals — the
  // other half of the "Include in Monthly Planning" toggle, so turning a
  // space on or off no longer requires leaving this page.
  const includedSpaceIds = useMemo(() => new Set((data?.spaces ?? []).map((s) => s.id)), [data]);
  const excludedSpaces = useMemo(
    () => allSpaces.filter((s) => !includedSpaceIds.has(s.id) && s.includeInMonthly !== true),
    [allSpaces, includedSpaceIds],
  );

  // Previewed totals — same math as the server, but filtered by what-if toggles.
  // Note: this is a presentation-only preview; it does NOT recompute garnishment
  // because that requires backend rules. Toggling a statutory deduction off will
  // not change a garnishment line until the user saves it (out of scope here).
  const preview = useMemo(() => {
    const inc = incomes.reduce((s, e) => s + (disabledEntries[e.id] ? 0 : e.amount), 0);
    const ded = deductions.reduce((s, e) => s + (disabledEntries[e.id] ? 0 : e.amount), 0);
    const exp = (data?.spaces ?? []).reduce((s, sp) => {
      if (disabledSpaces[sp.id]) return s;
      const total = sp.items.length === 0
        ? sp.monthTotal
        : sp.items.reduce((acc, it) => acc + (disabledItems[it.id] ? 0 : it.amountCrc), 0);
      return s + total;
    }, 0);
    return { incomeTotal: inc, deductionTotal: ded, expenseTotal: exp, leftover: inc - ded - exp };
  }, [incomes, deductions, data?.spaces, disabledEntries, disabledSpaces, disabledItems]);

  const openAddDeduction = useCallback(async () => {
    setShowAdd('deduction');
    setPickerMode('library');
    setAddLabel('');
    setAddAmount('');
    setAddRecurring(true);
    setAddPayPeriod(null);
    setPickerPayPeriod(null);
    setPicked({});
    setLibraryLoading(true);
    try {
      const rows = await api<LibraryDeduction[]>('/payroll/deductions');
      const active = rows.filter((d) => d.active);
      setLibrary(active);
      if (active.length && incomeSubjectTotal > 0) {
        const res = await api<CalcResp>('/payroll/calculate', {
          method: 'POST',
          body: { gross: incomeSubjectTotal, deductionIds: active.map((d) => d.id) },
        });
        const map: Record<string, number> = {};
        for (const item of res.deductions) map[item.id] = item.amount;
        setPreviewAmounts(map);
      } else {
        setPreviewAmounts({});
      }
    } finally {
      setLibraryLoading(false);
    }
  }, [incomeSubjectTotal]);

  async function submitPickedDeductions() {
    const ids = Object.entries(picked).filter(([, on]) => on).map(([id]) => id);
    if (ids.length === 0) return;
    setSubmittingPicker(true);
    try {
      for (const id of ids) {
        const d = library.find((x) => x.id === id);
        if (!d) continue;
        const amt = previewAmounts[id] ?? 0;
        await api('/budget/monthly/entries', {
          method: 'POST',
          body: {
            year,
            month,
            kind: 'deduction',
            label: d.name,
            amount: Math.round(amt),
            recurring: true,
            libraryDeductionId: id,
            payPeriod: pickerPayPeriod,
          },
        });
      }
      setShowAdd(null);
      setPicked({});
      await load();
    } finally {
      setSubmittingPicker(false);
    }
  }

  return (
    <AuthShell>
      <div className={`mx-auto max-w-2xl ${isMobile ? 'px-4 pb-24 pt-3' : 'px-6 py-6'}`}>
        <BudgetSubNav />
        <div className="mb-1 flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--ink-text)' }}>Monthly Planning</h1>
          <div className="flex items-center gap-2">
            <button className="z-btn z-btn-sm" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
              <ChevronLeft size={14} />
            </button>
            <div className="min-w-[110px] text-center text-sm font-medium" style={{ color: 'var(--ink-text)' }}>
              {MONTH_NAMES[month - 1]} {year}
            </div>
            <button className="z-btn z-btn-sm" aria-label="Next month" onClick={() => shiftMonth(1)}>
              <ChevronRight size={14} />
            </button>
            <button
              className="z-btn z-btn-sm inline-flex items-center gap-1"
              onClick={takeSnapshot}
              disabled={snapshotting || !data}
              aria-label="Snapshot this month"
              title="Save a snapshot of this month for reporting"
            >
              <Camera size={12} /> {snapshotting ? 'Saving…' : 'Snapshot'}
            </button>
          </div>
        </div>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-text-muted)' }}>
          The whole picture: income, deductions, and your tagged budget spaces.
        </p>
        {snapshotMsg && (
          <p className="mt-1 text-xs" style={{ color: 'var(--ink-text-secondary)' }}>{snapshotMsg}</p>
        )}

        {/* Summary */}
        {data && (
          <div
            className="mt-4 rounded-2xl border px-5 py-4"
            style={{ borderColor: 'var(--ink-border-subtle)', background: 'var(--ink-surface)', boxShadow: 'var(--ink-shadow-sm)' }}
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <span style={{ color: 'var(--ink-text-secondary)' }}>Income</span>
              <span className="text-right tabular-nums" style={{ color: 'var(--ink-text)' }}>{formatCRC(preview.incomeTotal)}</span>
              <span style={{ color: 'var(--ink-text-secondary)' }}>− Deductions</span>
              <span className="text-right tabular-nums" style={{ color: 'var(--ink-text)' }}>{formatCRC(preview.deductionTotal)}</span>
              <span style={{ color: 'var(--ink-text-secondary)' }}>− Planned</span>
              <span className="text-right tabular-nums" style={{ color: 'var(--ink-text)' }}>{formatCRC(preview.expenseTotal)}</span>
            </div>
            <div className="mt-3 flex items-baseline justify-between border-t pt-3" style={{ borderColor: 'var(--ink-border-subtle)' }}>
              <span className="text-sm font-medium" style={{ color: 'var(--ink-text)' }}>Leftover</span>
              <span
                className="text-lg font-semibold tabular-nums"
                style={{ color: preview.leftover >= 0 ? 'var(--ink-text)' : '#dc2626' }}
              >
                {formatCRC(preview.leftover)}
              </span>
            </div>
            {(Object.values(disabledEntries).some(Boolean)
              || Object.values(disabledSpaces).some(Boolean)
              || Object.values(disabledItems).some(Boolean)) && (
              <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
                What-if preview — toggles aren't saved. Saved leftover: {formatCRC(data.summary.leftover)}.
              </p>
            )}
          </div>
        )}

        {/* Cash flow — expected vs. actual bank balance per quincena */}
        {data?.cashflow && (
          <div
            className="mt-4 rounded-2xl border px-5 py-4"
            style={{ borderColor: 'var(--ink-border-subtle)', background: 'var(--ink-surface)', boxShadow: 'var(--ink-shadow-sm)' }}
          >
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-sm font-medium" style={{ color: 'var(--ink-text-secondary)' }}>Cash flow</h2>
              {savingCashflow && <span className="text-[11px]" style={{ color: 'var(--ink-text-faint)' }}>Saving…</span>}
            </div>
            <p className="mb-3 text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
              What lands in the bank each quincena. Expected = opening balance + net income − expenses already paid; drift = actual − expected.
            </p>

            <div className="mb-3 flex items-center justify-between gap-2">
              <label className="text-xs" style={{ color: 'var(--ink-text-secondary)' }}>Opening balance</label>
              <input
                className="z-input w-32 text-right tabular-nums"
                inputMode="decimal"
                value={openingInput}
                onChange={(e) => setOpeningInput(e.target.value)}
                onBlur={() => {
                  const v = parseAmount(openingInput);
                  if (v !== (data.cashflow.openingBalance ?? null)) saveCashflow({ openingBalance: v });
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                placeholder="₡0"
              />
            </div>

            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-1.5 text-sm">
              <span />
              <span className="text-right text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-text-faint)' }}>Quincena 1</span>
              <span className="text-right text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-text-faint)' }}>Quincena 2</span>

              <span style={{ color: 'var(--ink-text-secondary)' }}>Income</span>
              <span className="text-right tabular-nums" style={{ color: 'var(--ink-text)' }}>{formatCRC(data.cashflow.q1.income)}</span>
              <span className="text-right tabular-nums" style={{ color: 'var(--ink-text)' }}>{formatCRC(data.cashflow.q2.income)}</span>

              <span style={{ color: 'var(--ink-text-secondary)' }}>− Deductions</span>
              <span className="text-right tabular-nums" style={{ color: 'var(--ink-text)' }}>{formatCRC(data.cashflow.q1.deduction)}</span>
              <span className="text-right tabular-nums" style={{ color: 'var(--ink-text)' }}>{formatCRC(data.cashflow.q2.deduction)}</span>

              <span className="font-medium" style={{ color: 'var(--ink-text)' }}>Net</span>
              <span className="text-right font-medium tabular-nums" style={{ color: 'var(--ink-text)' }}>{formatCRC(data.cashflow.q1.net)}</span>
              <span className="text-right font-medium tabular-nums" style={{ color: 'var(--ink-text)' }}>{formatCRC(data.cashflow.q2.net)}</span>

              <span style={{ color: 'var(--ink-text-secondary)' }}>− Expenses paid</span>
              <span className="text-right tabular-nums" style={{ color: 'var(--ink-text)' }}>{formatCRC(data.cashflow.q1.expensePaid)}</span>
              <span className="text-right tabular-nums" style={{ color: 'var(--ink-text)' }}>{formatCRC(data.cashflow.q2.expensePaid)}</span>

              <span className="border-t pt-2 font-medium" style={{ borderColor: 'var(--ink-border-subtle)', color: 'var(--ink-text)' }}>Expected in bank</span>
              <span className="border-t pt-2 text-right font-medium tabular-nums" style={{ borderColor: 'var(--ink-border-subtle)', color: 'var(--ink-text)' }}>{formatCRC(data.cashflow.q1.expected)}</span>
              <span className="border-t pt-2 text-right font-medium tabular-nums" style={{ borderColor: 'var(--ink-border-subtle)', color: 'var(--ink-text)' }}>{formatCRC(data.cashflow.q2.expected)}</span>

              <span style={{ color: 'var(--ink-text-secondary)' }}>Actual in bank</span>
              <input
                className="z-input w-28 justify-self-end text-right tabular-nums"
                inputMode="decimal"
                value={q1Input}
                onChange={(e) => setQ1Input(e.target.value)}
                onBlur={() => {
                  const v = parseAmount(q1Input);
                  if (v !== (data.cashflow.q1.actual ?? null)) saveCashflow({ actualQ1: v });
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                placeholder="—"
              />
              <input
                className="z-input w-28 justify-self-end text-right tabular-nums"
                inputMode="decimal"
                value={q2Input}
                onChange={(e) => setQ2Input(e.target.value)}
                onBlur={() => {
                  const v = parseAmount(q2Input);
                  if (v !== (data.cashflow.q2.actual ?? null)) saveCashflow({ actualQ2: v });
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                placeholder="—"
              />

              <span style={{ color: 'var(--ink-text-secondary)' }}>Drift</span>
              <span className="text-right font-medium tabular-nums" style={{ color: data.cashflow.q1.drift == null ? 'var(--ink-text-faint)' : data.cashflow.q1.drift < 0 ? '#dc2626' : data.cashflow.q1.drift > 0 ? '#16a34a' : 'var(--ink-text-secondary)' }}>
                {data.cashflow.q1.drift == null ? '—' : formatSignedCRC(data.cashflow.q1.drift)}
              </span>
              <span className="text-right font-medium tabular-nums" style={{ color: data.cashflow.q2.drift == null ? 'var(--ink-text-faint)' : data.cashflow.q2.drift < 0 ? '#dc2626' : data.cashflow.q2.drift > 0 ? '#16a34a' : 'var(--ink-text-secondary)' }}>
                {data.cashflow.q2.drift == null ? '—' : formatSignedCRC(data.cashflow.q2.drift)}
              </span>
            </div>

            {(data.cashflow.q1.expensePlanned - data.cashflow.q1.expensePaid > 0
              || data.cashflow.q2.expensePlanned - data.cashflow.q2.expensePaid > 0) && (
              <p className="mt-3 border-t pt-2 text-[11px]" style={{ borderColor: 'var(--ink-border-subtle)', color: 'var(--ink-text-muted)' }}>
                Still unpaid — Q1 {formatCRC(data.cashflow.q1.expensePlanned - data.cashflow.q1.expensePaid)}, Q2 {formatCRC(data.cashflow.q2.expensePlanned - data.cashflow.q2.expensePaid)}.
                If paid, projected end balance: Q1 {formatCRC(data.cashflow.q1.projected)}, Q2 {formatCRC(data.cashflow.q2.projected)}.
              </p>
            )}
          </div>
        )}

        {loading && !data && (
          <p className="mt-6 text-sm" style={{ color: 'var(--ink-text-muted)' }}>Loading…</p>
        )}

        {/* Income */}
        <Section
          title="Income"
          total={preview.incomeTotal}
          onAdd={() => setShowAdd('income')}
        >
          {incomes.length === 0 && <Empty text="No income added yet." />}
          {incomes.map((e) => (
            <Row
              key={e.id}
              entry={e}
              disabled={!!disabledEntries[e.id]}
              onToggle={() => setDisabledEntries((m) => ({ ...m, [e.id]: !m[e.id] }))}
              isInlineEditing={inlineEditId === e.id}
              inlineValue={inlineEditValue}
              onInlineStart={() => { setInlineEditId(e.id); setInlineEditValue(String(e.amount)); }}
              onInlineChange={setInlineEditValue}
              onInlineCancel={() => setInlineEditId(null)}
              onInlineSave={() => saveInlineAmount(e)}
              onEdit={() => openEdit(e)}
              onDelete={() => deleteEntry(e.id)}
              onSetPayPeriod={(pp) => setPayPeriod(e, pp)}
            />
          ))}
        </Section>

        {/* Deductions */}
        <Section
          title="Deductions"
          total={preview.deductionTotal}
          onAdd={openAddDeduction}
          toggleAll={deductions.length === 0 ? undefined : {
            allOn: deductions.every((e) => !disabledEntries[e.id]),
            anyOn: deductions.some((e) => !disabledEntries[e.id]),
            onChange: (next) => {
              // next=true means "enable all" (clear disabled flags for these ids);
              // next=false means "disable all" (set them).
              setDisabledEntries((m) => {
                const updated = { ...m };
                for (const e of deductions) updated[e.id] = !next;
                return updated;
              });
            },
          }}
        >
          {deductions.length === 0 && <Empty text="No deductions added yet." />}
          {deductions.map((e) => (
            <Row
              key={e.id}
              entry={e}
              disabled={!!disabledEntries[e.id]}
              onToggle={() => setDisabledEntries((m) => ({ ...m, [e.id]: !m[e.id] }))}
              isInlineEditing={inlineEditId === e.id}
              inlineValue={inlineEditValue}
              onInlineStart={() => { setInlineEditId(e.id); setInlineEditValue(String(e.amount)); }}
              onInlineChange={setInlineEditValue}
              onInlineCancel={() => setInlineEditId(null)}
              onInlineSave={() => saveInlineAmount(e)}
              onEdit={() => openEdit(e)}
              onDelete={() => deleteEntry(e.id)}
              onSetPayPeriod={(pp) => setPayPeriod(e, pp)}
            />
          ))}
        </Section>

        {/* Spaces */}
        <Section title="Budget Spaces" total={preview.expenseTotal}>
          {(!data || data.spaces.length === 0) && (
            <Empty text={excludedSpaces.length > 0 ? 'No spaces included yet — add one below.' : 'No budget spaces yet.'} />
          )}
          {data?.spaces.map((s) => {
            const spaceDisabled = !!disabledSpaces[s.id];
            const expanded = !!expandedSpaces[s.id];
            const spacePreviewTotal = s.items.length === 0
              ? s.monthTotal
              : s.items.reduce((acc, it) => acc + (disabledItems[it.id] ? 0 : it.amountCrc), 0);
            return (
              <div key={s.id}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="shrink-0"
                    checked={!spaceDisabled}
                    onChange={() => setDisabledSpaces((m) => ({ ...m, [s.id]: !m[s.id] }))}
                    aria-label={`Include ${s.name} in totals`}
                    title="Include in totals"
                  />
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => setExpandedSpaces((m) => ({ ...m, [s.id]: !m[s.id] }))}
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${s.name}`}
                  >
                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    <span
                      className={`truncate text-sm ${spaceDisabled ? 'line-through opacity-50' : ''}`}
                      style={{ color: 'var(--ink-text)' }}
                    >
                      {s.name}
                    </span>
                    <span className="ml-1 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-text-faint)' }}>
                      {s.items.length} item{s.items.length === 1 ? '' : 's'}
                    </span>
                  </button>
                  <span
                    className={`mr-2 text-sm tabular-nums ${spaceDisabled ? 'line-through opacity-50' : ''}`}
                    style={{ color: 'var(--ink-text-secondary)' }}
                  >
                    {formatCRC(spacePreviewTotal)}
                  </span>
                  <button
                    className="z-btn z-btn-sm"
                    onClick={() => router.push(`/budget/${s.id}`)}
                    aria-label={`Open ${s.name}`}
                    title="Open space"
                  >
                    Open
                  </button>
                  <button
                    className="z-btn z-btn-sm"
                    onClick={() => toggleSpaceInMonthly(s.id, false)}
                    disabled={togglingSpaceId === s.id}
                    aria-label={`Remove ${s.name} from Monthly Planning`}
                    title="Stop including this space's totals here"
                  >
                    <X size={12} />
                  </button>
                </div>
                {expanded && (
                  <div className="border-t" style={{ borderColor: 'var(--ink-border-subtle)' }}>
                    {s.items.length === 0 && (
                      <p className="px-9 py-2 text-xs" style={{ color: 'var(--ink-text-muted)' }}>No items in the current period.</p>
                    )}
                    {s.items.map((it) => {
                      const itemDisabled = !!disabledItems[it.id] || spaceDisabled;
                      return (
                        <div key={it.id} className="flex items-center gap-2 py-1.5 pl-9 pr-3">
                          <input
                            type="checkbox"
                            className="shrink-0"
                            checked={!disabledItems[it.id]}
                            disabled={spaceDisabled}
                            onChange={() => setDisabledItems((m) => ({ ...m, [it.id]: !m[it.id] }))}
                            aria-label={`Include ${it.name} in totals`}
                          />
                          <div className="min-w-0 flex-1">
                            <p
                              className={`truncate text-xs ${itemDisabled ? 'line-through opacity-50' : ''}`}
                              style={{ color: 'var(--ink-text)' }}
                            >
                              {it.name}
                              {it.paid && (
                                <span className="ml-2 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-text-faint)' }}>paid</span>
                              )}
                              {it.category && (
                                <span className="ml-2 text-[10px]" style={{ color: 'var(--ink-text-faint)' }}>{it.category}</span>
                              )}
                            </p>
                          </div>
                          <span
                            className={`text-xs tabular-nums ${itemDisabled ? 'line-through opacity-50' : ''}`}
                            style={{ color: 'var(--ink-text-secondary)' }}
                          >
                            {formatCRC(it.amountCrc)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {excludedSpaces.length > 0 && (
            <div className="border-t px-3 py-2" style={{ borderColor: 'var(--ink-border-subtle)' }}>
              <button
                type="button"
                className="text-xs underline-offset-2 hover:underline"
                style={{ color: 'var(--ink-text-muted)' }}
                onClick={() => setShowExcludedSpaces((v) => !v)}
                aria-expanded={showExcludedSpaces}
              >
                {excludedSpaces.length} other space{excludedSpaces.length === 1 ? '' : 's'} not included {showExcludedSpaces ? '▴' : '▾'}
              </button>
              {showExcludedSpaces && (
                <div className="mt-2 space-y-1.5">
                  {excludedSpaces.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs" style={{ color: 'var(--ink-text-secondary)' }}>{s.name}</span>
                      <button
                        className="z-btn z-btn-sm"
                        onClick={() => toggleSpaceInMonthly(s.id, true)}
                        disabled={togglingSpaceId === s.id}
                      >
                        {togglingSpaceId === s.id ? 'Adding…' : 'Include'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Section>
      </div>

      {/* Add modal */}
      {showAdd === 'income' && (
        <Modal title="Add income" onClose={() => setShowAdd(null)}>
          <div className="space-y-3">
            <div>
              <label className="z-label">Label</label>
              <input
                className="z-input mt-1"
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                placeholder="Salary"
                autoFocus
              />
            </div>
            <div>
              <label className="z-label">Amount (CRC)</label>
              <input
                className="z-input mt-1"
                inputMode="decimal"
                value={addAmount}
                onChange={(e) => setAddAmount(e.target.value)}
                placeholder="0"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={addRecurring} onChange={(e) => setAddRecurring(e.target.checked)} />
              Repeat every month
            </label>
            <div>
              <label className="z-label">Pay period</label>
              <div className="mt-1">
                <PayPeriodPicker value={addPayPeriod} onChange={setAddPayPeriod} />
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={addSubject}
                onChange={(e) => setAddSubject(e.target.checked)}
              />
              <span>
                Subject to deductions
                <span className="block text-[11px]" style={{ color: 'var(--ink-text-faint)' }}>
                  Uncheck for income that should not feed CCSS / Renta / garnishment math (e.g. bank deposits).
                </span>
              </span>
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button className="z-btn" onClick={() => setShowAdd(null)}>Cancel</button>
              <button className="z-btn z-btn-primary" onClick={addEntry} disabled={!addLabel.trim()}>Add</button>
            </div>
          </div>
        </Modal>
      )}

      {showAdd === 'deduction' && (
        <Modal title="Add deduction" onClose={() => setShowAdd(null)}>
          <div className="mb-3 flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--ink-subtle)' }}>
            <button
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${pickerMode === 'library' ? 'bg-white shadow-sm' : ''}`}
              style={{ color: pickerMode === 'library' ? 'var(--ink-text)' : 'var(--ink-text-muted)' }}
              onClick={() => setPickerMode('library')}
            >
              From library
            </button>
            <button
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${pickerMode === 'custom' ? 'bg-white shadow-sm' : ''}`}
              style={{ color: pickerMode === 'custom' ? 'var(--ink-text)' : 'var(--ink-text-muted)' }}
              onClick={() => setPickerMode('custom')}
            >
              Custom amount
            </button>
          </div>

          {pickerMode === 'library' && (
            <div className="space-y-3">
              {incomeTotal <= 0 && (
                <p className="text-xs" style={{ color: '#dc2626' }}>
                  Add an income for {MONTH_NAMES[month - 1]} first — percentage and progressive deductions are computed against monthly income.
                </p>
              )}
              {libraryLoading && <p className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>Loading library…</p>}
              {!libraryLoading && library.length === 0 && (
                <div className="rounded-xl border px-3 py-4 text-center text-xs" style={{ borderColor: 'var(--ink-border-subtle)', color: 'var(--ink-text-muted)' }}>
                  Your library is empty.
                  <button
                    className="z-btn z-btn-sm ml-2"
                    onClick={() => router.push('/budget/deductions')}
                  >
                    Manage library →
                  </button>
                </div>
              )}
              {!libraryLoading && library.length > 0 && (
                <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border p-1" style={{ borderColor: 'var(--ink-border-subtle)' }}>
                  {library.map((d) => {
                    const amt = previewAmounts[d.id] ?? 0;
                    const alreadyAdded = linkedLibraryIds.has(d.id);
                    const isPicked = !!picked[d.id];
                    return (
                      <label
                        key={d.id}
                        className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 ${alreadyAdded ? 'opacity-50' : 'cursor-pointer hover:bg-[var(--ink-subtle)]'}`}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isPicked}
                            disabled={alreadyAdded}
                            onChange={(e) => setPicked((p) => ({ ...p, [d.id]: e.target.checked }))}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm" style={{ color: 'var(--ink-text)' }}>
                              {d.name}
                              {alreadyAdded && (
                                <span className="ml-2 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-text-faint)' }}>already added</span>
                              )}
                            </p>
                            <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-text-faint)' }}>
                              {d.kind === 'percentage' && d.rate != null ? `${(d.rate * 100).toFixed(2).replace(/\.00$/, '')}%` : d.kind}
                            </p>
                          </div>
                        </div>
                        <span className="text-sm tabular-nums" style={{ color: 'var(--ink-text-secondary)' }}>
                          {formatCRC(amt)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center justify-between border-t pt-2" style={{ borderColor: 'var(--ink-border-subtle)' }}>
                <span className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>Pay period</span>
                <PayPeriodPicker value={pickerPayPeriod} onChange={setPickerPayPeriod} size="sm" />
              </div>
              <div className="flex items-center justify-between pt-1">
                <button
                  className="text-xs underline"
                  style={{ color: 'var(--ink-text-muted)' }}
                  onClick={() => router.push('/budget/deductions')}
                >
                  Manage library →
                </button>
                <div className="flex gap-2">
                  <button className="z-btn" onClick={() => setShowAdd(null)} disabled={submittingPicker}>Cancel</button>
                  <button
                    className="z-btn z-btn-primary"
                    onClick={submitPickedDeductions}
                    disabled={submittingPicker || Object.values(picked).filter(Boolean).length === 0}
                  >
                    {submittingPicker ? 'Adding…' : 'Add selected'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {pickerMode === 'custom' && (
            <div className="space-y-3">
              <div>
                <label className="z-label">Label</label>
                <input
                  className="z-input mt-1"
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  placeholder="Tax / 401k / etc."
                  autoFocus
                />
              </div>
              <div>
                <label className="z-label">Amount (CRC)</label>
                <input
                  className="z-input mt-1"
                  inputMode="decimal"
                  value={addAmount}
                  onChange={(e) => setAddAmount(e.target.value)}
                  placeholder="0"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={addRecurring} onChange={(e) => setAddRecurring(e.target.checked)} />
                Repeat every month
              </label>
              <div>
                <label className="z-label">Pay period</label>
                <div className="mt-1">
                  <PayPeriodPicker value={addPayPeriod} onChange={setAddPayPeriod} />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button className="z-btn" onClick={() => setShowAdd(null)}>Cancel</button>
                <button className="z-btn z-btn-primary" onClick={addEntry} disabled={!addLabel.trim()}>Add</button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Edit modal */}
      {editing && (
        <Modal title={`Edit ${editing.kind}`} onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <div>
              <label className="z-label">Label</label>
              <input className="z-input mt-1" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="z-label">Amount (CRC)</label>
              <input className="z-input mt-1" inputMode="decimal" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editRecurring} onChange={(e) => setEditRecurring(e.target.checked)} />
              Repeat every month
            </label>
            <div>
              <label className="z-label">Pay period</label>
              <div className="mt-1">
                <PayPeriodPicker value={editPayPeriod} onChange={setEditPayPeriod} />
              </div>
            </div>
            {editing.kind === 'income' && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={editSubject}
                  onChange={(e) => setEditSubject(e.target.checked)}
                />
                <span>
                  Subject to deductions
                  <span className="block text-[11px]" style={{ color: 'var(--ink-text-faint)' }}>
                    Uncheck for income that should not feed CCSS / Renta / garnishment math (e.g. bank deposits).
                  </span>
                </span>
              </label>
            )}
            {editing.kind === 'deduction' && editing.libraryDeductionId && editing.amountOverridden && (
              <button
                className="z-btn z-btn-sm self-start"
                onClick={async () => { const e = editing; setEditing(null); await recalculateEntry(e); }}
              >
                Reset to auto-calculated amount
              </button>
            )}
            <div className="flex justify-between gap-2 pt-1">
              <button className="z-btn inline-flex items-center gap-1 text-red-600" onClick={() => deleteEntry(editing.id)}>
                <Trash2 size={14} /> Delete
              </button>
              <div className="flex gap-2">
                <button className="z-btn" onClick={() => setEditing(null)}>Cancel</button>
                <button className="z-btn z-btn-primary" onClick={saveEdit} disabled={!editLabel.trim()}>Save</button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </AuthShell>
  );
}

function Section({
  title,
  total,
  onAdd,
  toggleAll,
  children,
}: {
  title: string;
  total?: number;
  onAdd?: () => void;
  toggleAll?: { allOn: boolean; anyOn: boolean; onChange: (next: boolean) => void };
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          {toggleAll && (
            // Master enable/disable for every row in this section. Indeterminate
            // when some are on and some off, so the user sees mixed state.
            <input
              type="checkbox"
              className="shrink-0 self-center"
              checked={toggleAll.allOn}
              ref={(el) => { if (el) el.indeterminate = toggleAll.anyOn && !toggleAll.allOn; }}
              onChange={() => toggleAll.onChange(!toggleAll.allOn)}
              aria-label={`Include all ${title} in totals`}
              title={toggleAll.allOn ? `Disable all ${title}` : `Enable all ${title}`}
            />
          )}
          <h2 className="text-sm font-medium" style={{ color: 'var(--ink-text-secondary)' }}>{title}</h2>
          {total !== undefined && (
            <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--ink-text)' }}>
              {formatCRC(total)}
            </span>
          )}
        </div>
        {onAdd && (
          <button className="z-btn z-btn-sm inline-flex items-center gap-1" onClick={onAdd} aria-label={`Add ${title}`}>
            <Plus size={12} /> Add
          </button>
        )}
      </div>
      <div
        className="rounded-2xl border"
        style={{ borderColor: 'var(--ink-border-subtle)', background: 'var(--ink-surface)', boxShadow: 'var(--ink-shadow-sm)' }}
      >
        <div className="divide-y" style={{ borderColor: 'var(--ink-border-subtle)' }}>
          {children}
        </div>
      </div>
    </section>
  );
}

function Row({
  entry,
  disabled,
  onToggle,
  isInlineEditing,
  inlineValue,
  onInlineStart,
  onInlineChange,
  onInlineCancel,
  onInlineSave,
  onEdit,
  onDelete,
  onSetPayPeriod,
}: {
  entry: MonthlyEntry;
  disabled: boolean;
  onToggle: () => void;
  isInlineEditing: boolean;
  inlineValue: string;
  onInlineStart: () => void;
  onInlineChange: (v: string) => void;
  onInlineCancel: () => void;
  onInlineSave: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSetPayPeriod: (pp: 1 | 2 | null) => void;
}) {
  // Library-linked deductions show their rate (e.g. "10.5%") or kind label so
  // the user can see at a glance which line is statutory and how it's computed.
  let kindLabel: string | null = null;
  if (entry.kind === 'deduction' && entry.libraryKind) {
    if (entry.libraryKind === 'percentage' && entry.libraryRate != null) {
      const pct = (entry.libraryRate * 100).toFixed(2).replace(/\.?0+$/, '');
      kindLabel = `${pct}%`;
    } else if (entry.libraryKind === 'progressive') {
      kindLabel = 'progressive';
    } else if (entry.libraryKind === 'garnishment') {
      kindLabel = 'garnishment';
    }
  }
  // Library-linked deductions are auto-recomputed by the server from income,
  // but the user can still type a manual amount — the server flips an override
  // flag so the value sticks instead of being clobbered on next load.
  const inlineEditable = true;
  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      <input
        type="checkbox"
        className="shrink-0"
        checked={!disabled}
        onChange={onToggle}
        aria-label={`Include ${entry.label} in totals`}
        title="Include in totals"
      />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${disabled ? 'line-through opacity-50' : ''}`} style={{ color: 'var(--ink-text)' }}>
          {entry.label}
          {kindLabel && (
            <span className="ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide" style={{ background: 'var(--ink-subtle)', color: 'var(--ink-text-secondary)' }}>
              {kindLabel}
            </span>
          )}
          {entry.kind === 'deduction' && entry.libraryDeductionId && entry.amountOverridden && (
            <span className="ml-2 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-text-faint)' }} title="Manual override \u2014 not auto-recomputed">
              manual
            </span>
          )}
          {entry.kind === 'income' && entry.subjectToDeductions === false && (
            <span className="ml-2 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-text-faint)' }} title="Excluded from deduction calculations">
              no deductions
            </span>
          )}
          {entry.recurring && (
            <span className="ml-2 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-text-faint)' }}>recurs</span>
          )}
          {entry.payPeriod && (
            <span className="ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium sm:hidden" style={{ background: 'var(--ink-subtle)', color: 'var(--ink-text-secondary)' }}>
              Q{entry.payPeriod}
            </span>
          )}
        </p>
      </div>
      {isInlineEditing ? (
        <>
          <input
            className="z-input mr-1 w-24 text-right tabular-nums"
            inputMode="decimal"
            value={inlineValue}
            onChange={(ev) => onInlineChange(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') { ev.preventDefault(); onInlineSave(); }
              else if (ev.key === 'Escape') { ev.preventDefault(); onInlineCancel(); }
            }}
            autoFocus
          />
          <button className="z-btn z-btn-sm" onClick={onInlineSave} aria-label="Save amount">
            <Check size={12} />
          </button>
          <button className="z-btn z-btn-sm ml-1" onClick={onInlineCancel} aria-label="Cancel">
            <X size={12} />
          </button>
        </>
      ) : (
        <>
          <div className="mr-2 hidden sm:block">
            <PayPeriodPicker value={entry.payPeriod} onChange={onSetPayPeriod} size="sm" />
          </div>
          <button
            className={`mr-2 text-sm tabular-nums ${disabled ? 'line-through opacity-50' : ''} ${inlineEditable ? 'underline-offset-2 hover:underline' : 'cursor-default'}`}
            style={{ color: 'var(--ink-text-secondary)' }}
            onClick={inlineEditable ? onInlineStart : undefined}
            disabled={!inlineEditable}
            aria-label={inlineEditable ? 'Edit amount inline' : undefined}
            title={inlineEditable ? 'Click to edit amount' : 'Library-linked; edit in library to change rate'}
          >
            {formatCRC(entry.amount)}
          </button>
          <button className="z-btn z-btn-sm" onClick={onEdit} aria-label="Edit">
            <Pencil size={12} />
          </button>
          <button className="z-btn z-btn-sm ml-1 text-red-600" onClick={onDelete} aria-label="Delete">
            <Trash2 size={12} />
          </button>
        </>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="px-3 py-3 text-xs" style={{ color: 'var(--ink-text-muted)' }}>{text}</p>
  );
}

// Segmented selector for which quincena an entry hits the bank.
// null = "Both" (spans the two halves, split evenly in the cash-flow view).
function PayPeriodPicker({
  value,
  onChange,
  size = 'md',
}: {
  value: 1 | 2 | null;
  onChange: (v: 1 | 2 | null) => void;
  size?: 'sm' | 'md';
}) {
  const opts: { v: 1 | 2 | null; label: string; title: string }[] = [
    { v: 1, label: 'Q1', title: 'Quincena 1 (1st–15th)' },
    { v: 2, label: 'Q2', title: 'Quincena 2 (16th–end)' },
    { v: null, label: 'Both', title: 'Split evenly across both quincenas' },
  ];
  const pad = size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';
  return (
    <div className="inline-flex gap-0.5 rounded-lg p-0.5" style={{ background: 'var(--ink-subtle)' }}>
      {opts.map((o) => (
        <button
          key={o.label}
          type="button"
          onClick={() => onChange(o.v)}
          className={`rounded-md font-medium ${pad} ${value === o.v ? 'bg-white shadow-sm' : ''}`}
          style={{ color: value === o.v ? 'var(--ink-text)' : 'var(--ink-text-muted)' }}
          aria-pressed={value === o.v}
          title={o.title}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  // Close on Escape only. Clicking the backdrop is too easy to trigger by
  // accident while editing a value, so it no longer dismisses the modal —
  // use Cancel / Save / Esc instead.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'var(--ink-overlay)' }}
    >
      <div className="z-overlay z-animate-in w-full max-w-sm p-5">
        <h2 className="mb-3 text-base font-semibold capitalize">{title}</h2>
        {children}
      </div>
    </div>
  );
}
