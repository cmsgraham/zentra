'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Check, Download, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import AuthShell from '@/components/layout/AuthShell';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useIsMobile } from '@/lib/useIsMobile';
import type {
  BudgetCadence,
  BudgetCategory,
  BudgetEntryType,
  BudgetItem,
  BudgetPeriod,
  BudgetSpace,
  ExpenseTemplate,
  TemplatePeriodSlot,
  TemplateRecurrence,
} from '@/lib/useBudgetStore';

interface PeriodDetail extends BudgetPeriod {
  summary?: {
    plannedCount: number;
    unplannedCount: number;
    unpaidCount: number;
    totalAmount: number;
  };
}

interface ItemFormState {
  name: string;
  amount: string;
  dueDay: string;
  category: string;
}

interface TemplateFormState {
  name: string;
  defaultAmount: string;
  recurrence: TemplateRecurrence;
  defaultPeriodSlot: TemplatePeriodSlot;
  dueDay: string;
  category: string;
}

interface SpaceFormState {
  name: string;
  cadence: BudgetCadence;
  halfIndex: 1 | 2;
  includeInMonthly: boolean;
}

type CadenceFormValue = 'semi_monthly_1' | 'semi_monthly_2' | 'monthly' | 'none';

function cadenceFormValue(cadence: BudgetCadence, halfIndex: 1 | 2): CadenceFormValue {
  if (cadence === 'semi_monthly') return halfIndex === 2 ? 'semi_monthly_2' : 'semi_monthly_1';
  if (cadence === 'monthly') return 'monthly';
  return 'none';
}

function parseCadenceFormValue(value: CadenceFormValue): { cadence: BudgetCadence; halfIndex: 1 | 2 } {
  if (value === 'semi_monthly_1') return { cadence: 'semi_monthly', halfIndex: 1 };
  if (value === 'semi_monthly_2') return { cadence: 'semi_monthly', halfIndex: 2 };
  if (value === 'monthly') return { cadence: 'monthly', halfIndex: 1 };
  return { cadence: 'none', halfIndex: 1 };
}


type PaymentSort = 'name' | 'amount';
type BudgetTab = 'budget' | 'share';

// Helper: Detect currency and convert
function detectCurrency(amount: number) {
  // If below 6000, assume USD; else CRC
  return amount < 6000 ? 'USD' : 'CRC';
}

function convertToCRC(amount: number, rate: number) {
  return detectCurrency(amount) === 'USD' ? amount * rate : amount;
}

function convertToUSD(amount: number, rate: number) {
  return detectCurrency(amount) === 'CRC' ? amount / rate : amount;
}

interface Friend {
  id: string;
  name: string;
  email: string;
}

function amountText(amount: number): string {
  // Format with thousands separator and no decimals
  return Math.round(amount).toLocaleString('en-US');
}

function emptyItemForm(): ItemFormState {
  return { name: '', amount: '', dueDay: '', category: '' };
}

function emptyTemplateForm(): TemplateFormState {
  return {
    name: '',
    defaultAmount: '',
    recurrence: 'manual',
    defaultPeriodSlot: 'manual',
    dueDay: '',
    category: '',
  };
}

function statLine(period: PeriodDetail | null, items: BudgetItem[]): string {
  if (!period?.summary) return 'No items yet';
  return `${period.summary.plannedCount} planned · ${period.summary.unplannedCount} unplanned · ${amountText(period.summary.totalAmount)} total`;
}

function futurePurchaseStatLine(period: PeriodDetail | null): string {
  if (!period?.summary) return 'No purchases yet';
  return `${period.summary.plannedCount} pending · ${amountText(period.summary.totalAmount)} total`;
}

function csvEscape(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename: string, rows: string[][]): void {
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
  // Prepend BOM so Excel detects UTF-8 (accents in names render correctly).
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface MoneyPair { usd: number; crc: number }

function FinancialRow({
  label,
  all,
  remaining,
  emphasis,
}: {
  label: string;
  all: MoneyPair;
  remaining: MoneyPair;
  emphasis?: boolean;
}) {
  const labelStyle: React.CSSProperties = {
    color: emphasis ? 'var(--ink-text)' : 'var(--ink-text-secondary)',
    fontWeight: emphasis ? 500 : 400,
  };
  return (
    <>
      <div className="text-xs tracking-tight" style={labelStyle}>{label}</div>
      <FinancialCell value={all} emphasis={emphasis} />
      <FinancialCell value={remaining} emphasis={emphasis} />
    </>
  );
}

function FinancialCell({ value, emphasis }: { value: MoneyPair; emphasis?: boolean }) {
  return (
    <div className="text-right leading-tight">
      <div
        className="text-[13px]"
        style={{
          color: 'var(--ink-text)',
          fontWeight: emphasis ? 600 : 500,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.005em',
        }}
      >
        ₡{amountText(value.crc)}
      </div>
      <div
        className="text-[10px]"
        style={{ color: 'var(--ink-text-muted)', fontVariantNumeric: 'tabular-nums' }}
      >
        ${amountText(value.usd)}
      </div>
    </div>
  );
}

// Exchange rate is stored per-space on the server (see budget_spaces.exchange_rate).

export default function BudgetSpacePage() {
  const params = useParams() as { spaceId: string };
  const router = useRouter();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { spaceId } = params;

  const [space, setSpace] = useState<BudgetSpace | null>(null);
  // Per-space exchange rate, shared across all devices & members (persisted server-side).
  const [exchangeRate, setExchangeRate] = useState<number>(540);
  const [savingExchangeRate, setSavingExchangeRate] = useState(false);
  const [liveRate, setLiveRate] = useState<{ rate: number; fetchedAt: string } | null>(null);
  const [syncingRate, setSyncingRate] = useState(false);
  const [autoSyncedOnce, setAutoSyncedOnce] = useState(false);
  const [periods, setPeriods] = useState<BudgetPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [periodDetail, setPeriodDetail] = useState<PeriodDetail | null>(null);
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [library, setLibrary] = useState<ExpenseTemplate[]>([]);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<BudgetTab>('budget');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [shareUserId, setShareUserId] = useState('');

  const [showAddPlanned, setShowAddPlanned] = useState(false);
  const [showAddUnplanned, setShowAddUnplanned] = useState(false);
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);
  const [showLibraryManager, setShowLibraryManager] = useState(false);
  const [showPeriods, setShowPeriods] = useState(false);
  const [showEditSpace, setShowEditSpace] = useState(false);

  const [plannedForm, setPlannedForm] = useState<ItemFormState>(emptyItemForm());
  const [unplannedForm, setUnplannedForm] = useState<ItemFormState>(emptyItemForm());
  const [templateForm, setTemplateForm] = useState<TemplateFormState>(emptyTemplateForm());
  const [editingTemplate, setEditingTemplate] = useState<ExpenseTemplate | null>(null);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [paymentSort, setPaymentSort] = useState<PaymentSort>('name');

  const [editingItem, setEditingItem] = useState<BudgetItem | null>(null);
  const [editingItemForm, setEditingItemForm] = useState<ItemFormState>(emptyItemForm());
  const [spaceForm, setSpaceForm] = useState<SpaceFormState>({ name: '', cadence: 'semi_monthly', halfIndex: 1, includeInMonthly: false });

  const [selectedAmountIds, setSelectedAmountIds] = useState<Set<string>>(() => new Set());
  const toggleAmountSelect = useCallback((id: string) => {
    setSelectedAmountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearAmountSelect = useCallback(() => setSelectedAmountIds(new Set()), []);
  const selectedAmountTotal = useMemo(() => {
    let sum = 0;
    for (const it of items) {
      if (selectedAmountIds.has(it.id)) sum += convertToCRC(Number(it.amount), exchangeRate);
    }
    return sum;
  }, [items, selectedAmountIds, exchangeRate]);

  const sortPayments = useCallback((input: BudgetItem[]) => {
    return [...input].sort((a, b) => {
      if (paymentSort === 'amount') return b.amount - a.amount || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name) || b.amount - a.amount;
    });
  }, [paymentSort]);

  const plannedItems = useMemo(() => sortPayments(items.filter((item) => item.entryType === 'planned')), [items, sortPayments]);
  const unplannedItems = useMemo(() => sortPayments(items.filter((item) => item.entryType === 'unplanned')), [items, sortPayments]);

  // Totals in both currencies
  // Planned = all planned items, Current = only not paid
  const plannedTotals = useMemo(() => {
    let usd = 0, crc = 0;
    for (const item of plannedItems) {
      const amt = Number(item.amount);
      if (detectCurrency(amt) === 'USD') {
        usd += amt;
        crc += amt * exchangeRate;
      } else {
        crc += amt;
        usd += amt / exchangeRate;
      }
    }
    return { usd, crc };
  }, [plannedItems, exchangeRate]);
  const plannedCurrentTotals = useMemo(() => {
    let usd = 0, crc = 0;
    for (const item of plannedItems) {
      if (item.paid) continue;
      const amt = Number(item.amount);
      if (detectCurrency(amt) === 'USD') {
        usd += amt;
        crc += amt * exchangeRate;
      } else {
        crc += amt;
        usd += amt / exchangeRate;
      }
    }
    return { usd, crc };
  }, [plannedItems, exchangeRate]);
  const unplannedTotals = useMemo(() => {
    let usd = 0, crc = 0;
    for (const item of unplannedItems) {
      const amt = Number(item.amount);
      if (detectCurrency(amt) === 'USD') {
        usd += amt;
        crc += amt * exchangeRate;
      } else {
        crc += amt;
        usd += amt / exchangeRate;
      }
    }
    return { usd, crc };
  }, [unplannedItems, exchangeRate]);
  const unplannedCurrentTotals = useMemo(() => {
    let usd = 0, crc = 0;
    for (const item of unplannedItems) {
      if (item.paid) continue;
      const amt = Number(item.amount);
      if (detectCurrency(amt) === 'USD') {
        usd += amt;
        crc += amt * exchangeRate;
      } else {
        crc += amt;
        usd += amt / exchangeRate;
      }
    }
    return { usd, crc };
  }, [unplannedItems, exchangeRate]);
  const allTotals = useMemo(() => {
    return {
      usd: plannedTotals.usd + unplannedTotals.usd,
      crc: plannedTotals.crc + unplannedTotals.crc,
    };
  }, [plannedTotals, unplannedTotals]);
  const allCurrentTotals = useMemo(() => {
    return {
      usd: plannedCurrentTotals.usd + unplannedCurrentTotals.usd,
      crc: plannedCurrentTotals.crc + unplannedCurrentTotals.crc,
    };
  }, [plannedCurrentTotals, unplannedCurrentTotals]);
  const activeLibrary = useMemo(() => library.filter((item) => item.active), [library]);
  const availableLibrary = useMemo(() => {
    const addedTemplateIds = new Set(items.map((item) => item.templateId).filter(Boolean));
    return activeLibrary.filter((template) => !addedTemplateIds.has(template.id));
  }, [activeLibrary, items]);
  const selectedAvailableTemplateIds = useMemo(
    () => selectedTemplateIds.filter((id) => availableLibrary.some((template) => template.id === id)),
    [availableLibrary, selectedTemplateIds],
  );
  const isNoCadence = space?.cadence === 'none';

  const loadPeriods = useCallback(async () => {
    const periodData = await api<{ items: BudgetPeriod[] }>(`/budget/spaces/${spaceId}/periods`);
    const ordered = periodData.items;
    setPeriods(ordered);
    return ordered;
  }, [spaceId]);

  const loadLibrary = useCallback(async () => {
    const data = await api<{ items: ExpenseTemplate[] }>(`/budget/spaces/${spaceId}/library`);
    setLibrary(data.items);
  }, [spaceId]);

  const loadCategories = useCallback(async () => {
    const data = await api<{ items: BudgetCategory[] }>(`/budget/spaces/${spaceId}/categories`);
    setCategories(data.items);
  }, [spaceId]);

  const loadPeriod = useCallback(async (periodId: string) => {
    const detail = await api<PeriodDetail>(`/budget/periods/${periodId}`);
    const itemData = await api<{ items: BudgetItem[] }>(`/budget/periods/${periodId}/items`);
    setPeriodDetail(detail);
    setItems(itemData.items);
  }, []);

  const loadFriends = useCallback(async () => {
    const data = await api<{ items: Friend[] } | null>('/friends');
    if (!data) return;
    setFriends(data.items);
  }, []);

  const loadAll = useCallback(async (options?: { resetPeriod?: boolean }) => {
    setLoading(true);
    try {
      const spaceData = await api<BudgetSpace>(`/budget/spaces/${spaceId}`);
      setSpace(spaceData);
      if (typeof spaceData.exchangeRate === 'number' && spaceData.exchangeRate > 0) {
        setExchangeRate(spaceData.exchangeRate);
      }
      if (spaceData.library) setLibrary(spaceData.library);

      const allPeriods = await loadPeriods();
      if (!spaceData.library) await loadLibrary();
      await loadCategories();

      const initialPeriodId = options?.resetPeriod ? spaceData.currentPeriod?.id || allPeriods[0]?.id : selectedPeriodId || spaceData.currentPeriod?.id || allPeriods[0]?.id;
      if (initialPeriodId) {
        setSelectedPeriodId(initialPeriodId);
        await loadPeriod(initialPeriodId);
      } else {
        setPeriodDetail(null);
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, [spaceId, selectedPeriodId, loadLibrary, loadCategories, loadPeriod, loadPeriods]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Persist exchange rate per-space (debounced). A manual edit here will
  // flip auto_exchange_rate=false on the server, so future live-rate syncs
  // won't overwrite it.
  useEffect(() => {
    if (!space) return;
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) return;
    if (typeof space.exchangeRate === 'number' && Math.abs(space.exchangeRate - exchangeRate) < 0.0001) return;
    const handle = setTimeout(async () => {
      try {
        setSavingExchangeRate(true);
        await api(`/budget/spaces/${spaceId}`, {
          method: 'PUT',
          body: { exchangeRate },
        });
        setSpace((prev) => (prev ? { ...prev, exchangeRate, autoExchangeRate: false } : prev));
      } catch {
        // Silent fail; user can retry by editing again.
      } finally {
        setSavingExchangeRate(false);
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [exchangeRate, space, spaceId]);

  // Fetch the live USD→CRC rate. Server-side, /budget/exchange-rate also
  // propagates the rate to every space with auto_exchange_rate=true, so a
  // single call by any user keeps "actual and future" budgets in sync.
  const syncExchangeRate = useCallback(async (opts?: { apply?: boolean; silent?: boolean }) => {
    if (!opts?.silent) setSyncingRate(true);
    try {
      const data = await api<{ rate: number; source: string; fetchedAt: string } | null>('/budget/exchange-rate');
      if (!data || typeof data.rate !== 'number' || !(data.rate > 0)) return null;
      setLiveRate({ rate: data.rate, fetchedAt: data.fetchedAt });

      // If user clicked "sync" explicitly, also re-enable auto for *this* space
      // (in case they had previously typed a custom value).
      if (opts?.apply) {
        try {
          await api(`/budget/spaces/${spaceId}`, {
            method: 'PUT',
            body: { autoExchangeRate: true },
          });
          setSpace((prev) => (prev ? { ...prev, exchangeRate: data.rate, autoExchangeRate: true } : prev));
          setExchangeRate(Number(data.rate.toFixed(2)));
        } catch {
          // Best-effort; the live rate display still updates.
        }
      }
      return data;
    } catch {
      return null;
    } finally {
      if (!opts?.silent) setSyncingRate(false);
    }
  }, [spaceId]);

  // On first load, fetch the live rate once. This also triggers the server-side
  // bulk-update so any other auto-enabled spaces (this user's or shared) snap
  // to the current rate too. No "apply" needed — the server has already
  // updated this space's exchange_rate before /budget/spaces/:id returned.
  useEffect(() => {
    if (!space || autoSyncedOnce) return;
    setAutoSyncedOnce(true);
    syncExchangeRate({ silent: true });
  }, [space, autoSyncedOnce, syncExchangeRate]);

  useEffect(() => {
    if (tab === 'share') loadFriends();
  }, [tab, loadFriends]);

  async function refreshPeriodState(periodId: string | null) {
    if (!periodId) return;
    await loadPeriods();
    await loadPeriod(periodId);
  }

  async function createItem(form: ItemFormState, entryType: BudgetEntryType) {
    if (!selectedPeriodId) return;
    if (!form.name.trim() || !form.amount.trim()) return;

    setSaving(true);
    try {
      await api(`/budget/periods/${selectedPeriodId}/items`, {
        method: 'POST',
        body: {
          name: form.name.trim(),
          amount: Number(form.amount),
          entryType,
          paid: entryType === 'unplanned',
          dueDay: form.dueDay ? Number(form.dueDay) : null,
          category: form.category.trim() || null,
        },
      });
      await refreshPeriodState(selectedPeriodId);
      await loadCategories();
      if (entryType === 'planned') {
        setPlannedForm(emptyItemForm());
        setShowAddPlanned(false);
      } else {
        setUnplannedForm(emptyItemForm());
        setShowAddUnplanned(false);
      }
    } finally {
      setSaving(false);
    }
  }

  function closeLibraryPicker() {
    setShowLibraryPicker(false);
    setSelectedTemplateIds([]);
  }

  function toggleSelectedTemplate(templateId: string) {
    setSelectedTemplateIds((prev) => (prev.includes(templateId) ? prev.filter((id) => id !== templateId) : [...prev, templateId]));
  }

  async function addTemplatesToCurrentPeriod(templates: ExpenseTemplate[]) {
    if (!selectedPeriodId) return;
    if (templates.length === 0) return;
    setSaving(true);
    try {
      await Promise.all(
        templates.map((template) =>
          api(`/budget/periods/${selectedPeriodId}/items`, {
            method: 'POST',
            body: {
              templateId: template.id,
              name: template.name,
              amount: template.defaultAmount,
              entryType: 'planned',
              paid: false,
              dueDay: template.dueDay,
            },
          }),
        ),
      );
      await refreshPeriodState(selectedPeriodId);
      closeLibraryPicker();
    } finally {
      setSaving(false);
    }
  }

  async function addSelectedTemplatesToCurrentPeriod() {
    const selectedTemplates = availableLibrary.filter((template) => selectedTemplateIds.includes(template.id));
    await addTemplatesToCurrentPeriod(selectedTemplates);
  }

  async function buildBudgetFromLibrary() {
    if (!selectedPeriodId || !space || space.cadence === 'none') return;    setSaving(true);
    try {
      const result = await api<{ created: number; skipped: number; reset: number }>(
        `/budget/periods/${selectedPeriodId}/build-from-library`,
        { method: 'POST' },
      );
      await refreshPeriodState(selectedPeriodId);
      const parts: string[] = [];
      if (result.created > 0) parts.push(`${result.created} added`);
      if (result.reset > 0) parts.push(`${result.reset} unmarked`);
      if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
      window.alert(parts.length ? `Budget rebuilt: ${parts.join(', ')}.` : 'No changes — nothing to update.');
    } finally {
      setSaving(false);
    }
  }

  function exportPlannedCsv() {
    if (!space) return;
    const periodLabel = periodDetail?.label ?? space.currentPeriod?.label ?? 'period';
    const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
    const filename = `${sanitize(space.name)} - ${sanitize(periodLabel)} - Planned.csv`;
    const rows: string[][] = [['Name', 'Amount (CRC)', 'Paid', 'Due day']];
    for (const item of plannedItems) {
      const crcAmount = Math.round(convertToCRC(Number(item.amount), exchangeRate));
      rows.push([
        item.name,
        String(crcAmount),
        item.paid ? 'yes' : 'no',
        item.dueDay != null ? String(item.dueDay) : '',
      ]);
    }
    downloadCsv(filename, rows);
  }

  async function togglePaid(item: BudgetItem) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, paid: !i.paid } : i)));
    try {
      await api(`/budget/items/${item.id}/toggle-paid`, { method: 'POST' });
      if (selectedPeriodId) await refreshPeriodState(selectedPeriodId);
    } catch {
      if (selectedPeriodId) await refreshPeriodState(selectedPeriodId);
    }
  }

  async function removeItem(itemId: string) {
    setSaving(true);
    try {
      await api(`/budget/items/${itemId}`, { method: 'DELETE' });
      if (selectedPeriodId) await refreshPeriodState(selectedPeriodId);
    } finally {
      setSaving(false);
    }
  }

  function startEditItem(item: BudgetItem) {
    setEditingItem(item);
    setEditingItemForm({
      name: item.name,
      amount: String(Math.round(item.amount)),
      dueDay: item.dueDay ? String(item.dueDay) : '',
      category: item.category ?? '',
    });
  }

  async function saveItemEdit() {
    if (!editingItem) return;
    if (!editingItemForm.name.trim() || !editingItemForm.amount.trim()) return;
    setSaving(true);
    try {
      await api(`/budget/items/${editingItem.id}`, {
        method: 'PUT',
        body: {
          name: editingItemForm.name.trim(),
          amount: Number(editingItemForm.amount),
          dueDay: editingItemForm.dueDay ? Number(editingItemForm.dueDay) : null,
          category: editingItemForm.category.trim() || null,
        },
      });
      if (selectedPeriodId) await refreshPeriodState(selectedPeriodId);
      await loadCategories();
      await loadLibrary();
      setEditingItem(null);
      setEditingItemForm(emptyItemForm());
    } finally {
      setSaving(false);
    }
  }

  function startTemplateEdit(template: ExpenseTemplate) {
    setEditingTemplate(template);
    setTemplateForm({
      name: template.name,
      defaultAmount: String(Math.round(template.defaultAmount)),
      recurrence: template.recurrence,
      defaultPeriodSlot: template.defaultPeriodSlot,
      dueDay: template.dueDay ? String(template.dueDay) : '',
      category: template.category ?? '',
    });
  }

  async function saveTemplate() {
    if (!space) return;
    if (!templateForm.name.trim() || !templateForm.defaultAmount.trim()) return;

    setSaving(true);
    try {
      const body = {
        name: templateForm.name.trim(),
        defaultAmount: Number(templateForm.defaultAmount),
        recurrence: templateForm.recurrence,
        defaultPeriodSlot: templateForm.defaultPeriodSlot,
        dueDay: templateForm.dueDay ? Number(templateForm.dueDay) : null,
        active: true,
        category: templateForm.category.trim() || null,
      };

      if (editingTemplate) {
        await api(`/budget/library/${editingTemplate.id}`, { method: 'PUT', body });
      } else {
        await api(`/budget/spaces/${space.id}/library`, { method: 'POST', body });
      }

      setTemplateForm(emptyTemplateForm());
      setEditingTemplate(null);
      await loadLibrary();
      await loadCategories();
    } finally {
      setSaving(false);
    }
  }

  async function disableTemplate(template: ExpenseTemplate) {
    setSaving(true);
    try {
      await api(`/budget/library/${template.id}`, { method: 'DELETE' });
      await loadLibrary();
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(template: ExpenseTemplate) {
    const confirmed = window.confirm(
      `Delete "${template.name}" from the expense library? This cannot be undone. Items already added to periods will remain.`,
    );
    if (!confirmed) return;
    setSaving(true);
    try {
      await api(`/budget/library/${template.id}/permanent`, { method: 'DELETE' });
      await loadLibrary();
    } finally {
      setSaving(false);
    }
  }

  async function ensureMonthPeriods() {
    if (!space) return;
    if (space.cadence === 'none') return;
    const now = new Date();
    setSaving(true);
    try {
      await api(`/budget/spaces/${space.id}/periods`, {
        method: 'POST',
        body: {
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          generateSemiMonthly: space.cadence === 'semi_monthly',
        },
      });
      await loadPeriods();
    } finally {
      setSaving(false);
    }
  }

  async function shareWithUser() {
    if (!shareUserId) return;
    await api(`/budget/spaces/${spaceId}/share`, {
      method: 'POST',
      body: { userId: shareUserId, role: 'editor' },
    });
    setShareUserId('');
    await loadAll();
  }

  async function removeMember(memberId: string) {
    await api(`/budget/spaces/${spaceId}/members/${memberId}`, { method: 'DELETE' });
    await loadAll();
  }

  function startEditSpace() {
    if (!space) return;
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const cp = space.currentPeriod;
    let halfIndex: 1 | 2 = now.getDate() <= 15 ? 1 : 2;
    if (
      space.cadence === 'semi_monthly' &&
      cp && cp.year === y && cp.month === m &&
      (cp.periodIndex === 1 || cp.periodIndex === 2)
    ) {
      halfIndex = cp.periodIndex;
    }
    setSpaceForm({ name: space.name, cadence: space.cadence, halfIndex, includeInMonthly: space.includeInMonthly === true });
    setShowEditSpace(true);
  }

  async function saveSpaceEdit() {
    if (!space || !spaceForm.name.trim()) return;
    setSaving(true);
    try {
      await api(`/budget/spaces/${space.id}`, {
        method: 'PUT',
        body: { name: spaceForm.name.trim(), cadence: spaceForm.cadence, includeInMonthly: spaceForm.includeInMonthly },
      });
      setSelectedPeriodId(null);
      await loadAll({ resetPeriod: true });
      if (spaceForm.cadence === 'semi_monthly') {
        await setCurrentSemiHalf(spaceForm.halfIndex);
      }
      setShowEditSpace(false);
    } finally {
      setSaving(false);
    }
  }

  async function setCurrentSemiHalf(targetIndex: 1 | 2) {
    if (!space || space.cadence !== 'semi_monthly') return;
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;

    // Find matching period for current month + half (if missing, generate this month's periods first).
    let target = periods.find((p) => p.year === y && p.month === m && p.periodIndex === targetIndex);
    if (!target) {
      setSaving(true);
      try {
        await api(`/budget/spaces/${space.id}/periods`, {
          method: 'POST',
          body: { year: y, month: m, generateSemiMonthly: true },
        });
        const refreshed = await loadPeriods();
        target = refreshed.find((p) => p.year === y && p.month === m && p.periodIndex === targetIndex);
      } finally {
        setSaving(false);
      }
    }
    if (!target) return;

    setSaving(true);
    try {
      await api(`/budget/periods/${target.id}`, {
        method: 'PUT',
        body: { isCurrent: true },
      });
      setSelectedPeriodId(target.id);
      await loadPeriod(target.id);
      await loadPeriods();
      // Refresh space so currentPeriod reflects the new active half.
      const spaceData = await api<BudgetSpace>(`/budget/spaces/${space.id}`);
      setSpace(spaceData);
    } finally {
      setSaving(false);
    }
  }

  async function deleteSpace() {
    if (!space) return;
    const confirmed = window.confirm(
      `Delete budget space "${space.name}"? This will permanently remove all its periods, items, and expense library. This cannot be undone.`,
    );
    if (!confirmed) return;
    setSaving(true);
    try {
      await api(`/budget/spaces/${space.id}`, { method: 'DELETE' });
      router.push('/budget');
    } finally {
      setSaving(false);
    }
  }

  const actionButtons = (
    <>
      {!isNoCadence && (
        <button
          className="z-btn z-btn-primary"
          onClick={buildBudgetFromLibrary}
          disabled={saving || !selectedPeriodId}
          title="Add applicable items from your Expense Library to this period"
        >
          Build Budget
        </button>
      )}
      <button className="z-btn" onClick={() => setShowLibraryPicker(true)}>Add from Expense Library</button>
      <button className="z-btn" onClick={() => setShowAddPlanned(true)}>{isNoCadence ? 'Add future purchase' : 'Add one-time planned'}</button>
      {!isNoCadence && <button className="z-btn" onClick={() => setShowAddUnplanned(true)}>Add unplanned</button>}
      <button className="z-btn" onClick={() => setShowLibraryManager(true)}>Open Expense Library</button>
      {!isNoCadence && <button className="z-btn" onClick={() => setShowPeriods(true)}>Other periods</button>}
    </>
  );

  return (
    <AuthShell>
      <div className={`mx-auto max-w-4xl ${isMobile ? 'px-4 pb-24 pt-3' : 'px-6 py-6'}`}>
        {loading && (
          <div className="rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--ink-border-subtle)', color: 'var(--ink-text-muted)' }}>
            Loading budget space...
          </div>
        )}

        {!loading && !space && (
          <div className="rounded-xl border p-5" style={{ borderColor: 'var(--ink-border-subtle)', background: 'var(--ink-surface)' }}>
            <p className="text-sm">Space not found.</p>
            <button className="z-btn mt-3" onClick={() => router.push('/budget')}>Back to Budget</button>
          </div>
        )}

        {!loading && space && (
          <>
            <div className="rounded-2xl border" style={{ borderColor: 'var(--ink-border-subtle)', background: 'var(--ink-surface)', boxShadow: 'var(--ink-shadow-sm)' }}>
              {/* ── Header ── */}
              <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3 pb-2">
                <div className="min-w-0">
                  <h1 className="text-base font-semibold leading-tight tracking-tight" style={{ color: 'var(--ink-text)' }}>{space.name}</h1>
                  <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-text-secondary)' }}>
                    {isNoCadence ? 'No cadence' : periodDetail?.label ?? space.currentPeriod?.label ?? 'Current period'}
                  </p>
                  {periodDetail?.summary && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px]"
                        style={{ background: 'var(--ink-subtle, var(--ink-border-subtle))', color: 'var(--ink-text-secondary)' }}
                      >
                        {isNoCadence
                          ? `${periodDetail.summary.plannedCount} pending`
                          : `${periodDetail.summary.plannedCount + periodDetail.summary.unplannedCount} items`}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <button className="z-btn z-btn-sm" onClick={startEditSpace} aria-label="Edit space">
                    <Pencil size={12} />
                  </button>
                  <button className="z-btn z-btn-sm" onClick={() => router.push('/budget')}>All</button>
                </div>
              </div>

              {/* ── Financial grid (rows × columns) ── */}
              <div className="px-4 pb-3">
                <div
                  className="grid items-baseline gap-x-4 gap-y-2"
                  style={{ gridTemplateColumns: 'minmax(64px, auto) 1fr 1fr', fontVariantNumeric: 'tabular-nums' }}
                >
                  <div />
                  <div className="text-right text-[9px] uppercase tracking-[0.14em]" style={{ color: 'var(--ink-text-faint)' }}>
                    All
                  </div>
                  <div className="text-right text-[9px] uppercase tracking-[0.14em]" style={{ color: 'var(--ink-text-faint)' }}>
                    Remaining
                  </div>

                  {([
                    { label: 'Planned', all: plannedTotals, remaining: plannedCurrentTotals, emphasis: false },
                    { label: 'Unplanned', all: unplannedTotals, remaining: unplannedCurrentTotals, emphasis: false },
                    { label: 'Total', all: allTotals, remaining: allCurrentTotals, emphasis: true },
                  ] as const).map((row) => (
                    <FinancialRow key={row.label} label={row.label} all={row.all} remaining={row.remaining} emphasis={row.emphasis} />
                  ))}
                </div>
              </div>

              {/* ── Quiet footer ── */}
              <div
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-[10px]"
                style={{ borderColor: 'var(--ink-border-subtle)', color: 'var(--ink-text-faint)' }}
              >
                <span className="inline-flex items-center gap-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  <span>1 USD =</span>
                  <span aria-hidden>₡</span>
                  <input
                    type="number"
                    min="300"
                    max="10000"
                    step="0.01"
                    value={exchangeRate}
                    onChange={(e) => setExchangeRate(Number(e.target.value))}
                    className="bg-transparent outline-none focus:outline-none"
                    style={{
                      width: 52,
                      border: 'none',
                      padding: 0,
                      color: 'var(--ink-text-secondary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                    aria-label="USD to CRC exchange rate"
                  />
                  <button
                    type="button"
                    onClick={() => syncExchangeRate({ apply: true })}
                    disabled={syncingRate}
                    title={
                      liveRate
                        ? `Live ₡${liveRate.rate.toFixed(2)} · ${new Date(liveRate.fetchedAt).toLocaleString()}\nClick to enable auto-sync for this space`
                        : 'Fetch live rate'
                    }
                    className="inline-flex items-center"
                    style={{ color: 'var(--ink-text-faint)', opacity: syncingRate ? 0.5 : 1 }}
                    aria-label="Sync live exchange rate"
                  >
                    <RefreshCw size={9} className={syncingRate ? 'animate-spin' : ''} />
                  </button>
                  {savingExchangeRate
                    ? <span>· saving</span>
                    : space.autoExchangeRate
                      ? <span title="Updates automatically from api.hacienda.go.cr">· auto</span>
                      : <span title="Manual override — click ↻ to switch back to auto">· manual</span>}
                </span>
                {space.ownerName && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{space.isOwner ? 'You' : space.ownerName}</span>
                  </>
                )}
                {(space.members?.length ?? 0) > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{space.members!.length} member{space.members!.length === 1 ? '' : 's'}</span>
                  </>
                )}
              </div>
            </div>

            <div className="mt-3 flex gap-1 rounded-lg p-1" style={{ background: 'var(--ink-subtle, var(--ink-border))' }}>
              {(['budget', 'share'] as BudgetTab[]).map((section) => (
                <button
                  key={section}
                  className="flex-1 rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors"
                  style={{
                    background: tab === section ? 'var(--ink-surface)' : 'transparent',
                    color: tab === section ? 'var(--ink-text)' : 'var(--ink-text-muted)',
                  }}
                  onClick={() => setTab(section)}
                >
                  {section}
                </button>
              ))}
            </div>

            {tab === 'budget' && (
              <>
                <div className="mt-3 flex flex-wrap gap-2">{actionButtons}</div>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <span className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>Sort</span>
                  <div className="flex rounded-lg border p-0.5" style={{ borderColor: 'var(--ink-border-subtle)', background: 'var(--ink-surface)' }}>
                    {(['name', 'amount'] as PaymentSort[]).map((sort) => (
                      <button
                        key={sort}
                        className="rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors"
                        style={{
                          background: paymentSort === sort ? 'var(--ink-subtle)' : 'transparent',
                          color: paymentSort === sort ? 'var(--ink-text)' : 'var(--ink-text-muted)',
                        }}
                        onClick={() => setPaymentSort(sort)}
                      >
                        {sort}
                      </button>
                    ))}
                  </div>
                </div>

            <div className={`mt-4 grid gap-4 ${isNoCadence ? '' : 'md:grid-cols-[minmax(0,1fr)_18rem]'}`}>
              <section className="rounded-2xl border" style={{ borderColor: 'var(--ink-border-subtle)', background: 'var(--ink-surface)' }}>
                <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--ink-border-subtle)' }}>
                  <h2 className="text-sm font-semibold">{isNoCadence ? 'Pending purchases' : 'Planned'}</h2>
                  <button
                    type="button"
                    onClick={exportPlannedCsv}
                    disabled={plannedItems.length === 0}
                    aria-label="Download planned as CSV"
                    title="Download CSV"
                    className="rounded-md p-1 transition-colors hover:bg-[var(--ink-subtle)] disabled:opacity-40"
                    style={{ color: 'var(--ink-text-muted)' }}
                  >
                    <Download size={14} />
                  </button>
                </div>
                <div className="p-2">
                  {plannedItems.length === 0 && (
                    <p className="px-2 py-6 text-center text-sm" style={{ color: 'var(--ink-text-faint)' }}>
                      {isNoCadence ? 'No future purchases yet.' : 'No planned items yet.'}
                    </p>
                  )}
                  {(() => {
                    const orderMap = new Map<string, number>();
                    categories.forEach((c) => orderMap.set(c.name, c.sortOrder));
                    const groups = new Map<string, BudgetItem[]>();
                    for (const it of plannedItems) {
                      const key = it.category ?? '';
                      const arr = groups.get(key) ?? [];
                      arr.push(it);
                      groups.set(key, arr);
                    }
                    const keys = Array.from(groups.keys()).sort((a, b) => {
                      if (a === '' && b !== '') return 1;
                      if (b === '' && a !== '') return -1;
                      const ao = orderMap.get(a);
                      const bo = orderMap.get(b);
                      if (ao != null && bo != null) return ao - bo;
                      if (ao != null) return -1;
                      if (bo != null) return 1;
                      return a.localeCompare(b);
                    });
                    return keys.map((key, idx) => {
                      const groupItems = groups.get(key) ?? [];
                      const subtotalCrc = groupItems.reduce(
                        (sum, it) => sum + Math.round(convertToCRC(Number(it.amount), exchangeRate)),
                        0,
                      );
                      const showHeader = keys.length > 1 || key !== '';
                      return (
                        <div key={key || '__uncat'} className={idx === 0 ? '' : 'mt-5'}>
                          {showHeader && (
                            <div className="mb-1 flex items-baseline justify-between px-2">
                              <span
                                className="text-[11px]"
                                style={{
                                  color: 'var(--ink-text-muted)',
                                  letterSpacing: '0.04em',
                                }}
                              >
                                {key || 'Uncategorized'}
                              </span>
                              <span
                                className="text-[10px]"
                                style={{
                                  color: 'var(--ink-text-faint)',
                                  fontVariantNumeric: 'tabular-nums',
                                }}
                              >
                                ₡{amountText(subtotalCrc)}
                              </span>
                            </div>
                          )}
                          {groupItems.map((item) => (
                            <ItemRow key={item.id} item={item} exchangeRate={exchangeRate} onTogglePaid={togglePaid} onEdit={startEditItem} onDelete={removeItem} selected={selectedAmountIds.has(item.id)} onToggleSelect={toggleAmountSelect} />
                          ))}
                        </div>
                      );
                    });
                  })()}
                </div>
              </section>

              {!isNoCadence && <section className="rounded-2xl border" style={{ borderColor: 'var(--ink-border-subtle)', background: 'var(--ink-surface)' }}>
                <div className="border-b px-3 py-2.5" style={{ borderColor: 'var(--ink-border-subtle)' }}>
                  <h2 className="text-xs font-semibold">Unplanned</h2>
                </div>
                <div className="p-1.5">
                  {unplannedItems.length === 0 && (
                    <p className="px-2 py-4 text-center text-xs" style={{ color: 'var(--ink-text-faint)' }}>
                      Nothing recorded.
                    </p>
                  )}
                  {unplannedItems.map((item) => (
                    <ItemRow key={item.id} item={item} compact exchangeRate={exchangeRate} onTogglePaid={togglePaid} onEdit={startEditItem} onDelete={removeItem} selected={selectedAmountIds.has(item.id)} onToggleSelect={toggleAmountSelect} />
                  ))}
                </div>
              </section>}
            </div>
              </>
            )}

            {tab === 'share' && (
              <div className="mt-4 space-y-4">
                {space.isOwner && (
                  <div className="flex gap-2">
                    <select
                      value={shareUserId}
                      onChange={(e) => setShareUserId(e.target.value)}
                      className="z-select flex-1"
                    >
                      <option value="">Select a friend to share with</option>
                      {friends
                        .filter((friend) => !space.members?.some((member) => member.userId === friend.id))
                        .map((friend) => (
                          <option key={friend.id} value={friend.id}>
                            {friend.name} ({friend.email})
                          </option>
                        ))}
                    </select>
                    <button className="z-btn z-btn-primary" onClick={shareWithUser} disabled={!shareUserId}>
                      Share
                    </button>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="rounded-xl border p-3" style={{ background: 'var(--ink-surface)', borderColor: 'var(--ink-border)' }}>
                    <p className="text-sm font-medium">{space.ownerName ?? 'Owner'} (owner)</p>
                  </div>

                  {(space.members ?? []).map((member) => (
                    <div
                      key={member.userId}
                      className="flex items-center justify-between rounded-xl border p-3"
                      style={{ background: 'var(--ink-surface)', borderColor: 'var(--ink-border)' }}
                    >
                      <div>
                        <p className="text-sm font-medium">{member.name}</p>
                        <p className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>{member.email}</p>
                      </div>
                      {(space.isOwner || member.userId === user?.id) && (
                        <button className="z-btn z-btn-xs" onClick={() => removeMember(member.userId)}>
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showAddPlanned && (
        <SimpleModal title={isNoCadence ? 'Add future purchase' : 'Add one-time planned'} onClose={() => setShowAddPlanned(false)}>
          <ItemForm
            value={plannedForm}
            onChange={setPlannedForm}
            onSubmit={() => createItem(plannedForm, 'planned')}
            submitLabel={isNoCadence ? 'Add purchase' : 'Add planned'}
            saving={saving}
            categories={categories}
          />
        </SimpleModal>
      )}

      {showAddUnplanned && (
        <SimpleModal title="Add unplanned payment" onClose={() => setShowAddUnplanned(false)}>
          <ItemForm
            value={unplannedForm}
            onChange={setUnplannedForm}
            onSubmit={() => createItem(unplannedForm, 'unplanned')}
            submitLabel="Add unplanned"
            saving={saving}
            categories={categories}
          />
          <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
            Unplanned entries default to paid.
          </p>
        </SimpleModal>
      )}

      {showEditSpace && (
        <SimpleModal title="Edit Space" onClose={() => setShowEditSpace(false)}>
          <div className="space-y-3">
            <div>
              <label className="z-label">Name</label>
              <input
                className="z-input mt-1"
                value={spaceForm.name}
                onChange={(e) => setSpaceForm({ ...spaceForm, name: e.target.value })}
                autoFocus
              />
            </div>
            <div>
              <label className="z-label">Cadence</label>
              <select
                className="z-select mt-1"
                value={cadenceFormValue(spaceForm.cadence, spaceForm.halfIndex)}
                onChange={(e) => {
                  const parsed = parseCadenceFormValue(e.target.value as CadenceFormValue);
                  setSpaceForm({ ...spaceForm, cadence: parsed.cadence, halfIndex: parsed.halfIndex });
                }}
              >
                <option value="semi_monthly_1">Semi-monthly 1-15</option>
                <option value="semi_monthly_2">Semi-monthly 16-end</option>
                <option value="monthly">Monthly</option>
                <option value="none">No cadence (future purchases)</option>
              </select>
              {spaceForm.cadence === 'semi_monthly' && (
                <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
                  Selects the active half of the current month.
                </p>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-text)' }}>
              <input
                type="checkbox"
                checked={spaceForm.includeInMonthly}
                onChange={(e) => setSpaceForm({ ...spaceForm, includeInMonthly: e.target.checked })}
              />
              Include in Monthly Planning
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="z-btn" onClick={() => setShowEditSpace(false)}>
                Cancel
              </button>
              <button type="button" className="z-btn z-btn-primary" onClick={saveSpaceEdit} disabled={saving || !spaceForm.name.trim()}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
            {space?.isOwner && (
              <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--ink-border-subtle)' }}>
                <p className="z-label" style={{ color: 'var(--ink-text-muted)' }}>Danger zone</p>
                <button
                  type="button"
                  className="z-btn mt-2 inline-flex items-center gap-1.5 text-red-600"
                  onClick={deleteSpace}
                  disabled={saving}
                >
                  <Trash2 size={14} />
                  Delete this budget space
                </button>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
                  Removes all periods, items, and the expense library for this space.
                </p>
              </div>
            )}
          </div>
        </SimpleModal>
      )}

      {showLibraryPicker && (
        <SimpleModal title="Add from Expense Library" onClose={closeLibraryPicker}>
          <div className="space-y-2">
            {activeLibrary.length === 0 && (
              <p className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>
                Your Expense Library is empty.
              </p>
            )}
            {activeLibrary.length > 0 && availableLibrary.length === 0 && (
              <p className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>
                All library payments are already in this period.
              </p>
            )}
            {availableLibrary.map((template) => (
              <button
                key={template.id}
                className="w-full rounded-lg border px-3 py-2 text-left transition-colors"
                style={{
                  borderColor: selectedTemplateIds.includes(template.id) ? 'var(--ink-accent)' : 'var(--ink-border-subtle)',
                  background: selectedTemplateIds.includes(template.id) ? 'var(--ink-accent-light)' : 'var(--ink-surface)',
                }}
                onClick={() => toggleSelectedTemplate(template.id)}
                aria-pressed={selectedTemplateIds.includes(template.id)}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="task-checkbox mt-0.5"
                    data-checked={selectedTemplateIds.includes(template.id)}
                    aria-hidden="true"
                  >
                    {selectedTemplateIds.includes(template.id) ? <Check size={12} strokeWidth={3} /> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">{template.name}</p>
                      <p className="text-sm" style={{ color: 'var(--ink-text-secondary)' }}>{amountText(template.defaultAmount)}</p>
                    </div>
                    <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
                      {template.defaultPeriodSlot} · {template.recurrence}{template.dueDay ? ` · due ${template.dueDay}` : ''}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
          {availableLibrary.length > 0 && (
            <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: 'var(--ink-border-subtle)' }}>
              <p className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
                {selectedAvailableTemplateIds.length} selected
              </p>
              <button className="z-btn z-btn-primary" onClick={addSelectedTemplatesToCurrentPeriod} disabled={saving || selectedAvailableTemplateIds.length === 0}>
                Add selected
              </button>
            </div>
          )}
        </SimpleModal>
      )}

      {showPeriods && (
        <SimpleModal title="Other periods" onClose={() => setShowPeriods(false)}>
          <div className="mb-3 flex items-center gap-2">
            <button className="z-btn z-btn-sm" onClick={ensureMonthPeriods}>
              Ensure this month
            </button>
            <p className="text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
              Creates missing periods for current month.
            </p>
          </div>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {periods.map((period) => (
              <button
                key={period.id}
                className="w-full rounded-lg border px-3 py-2 text-left"
                style={{
                  borderColor: period.id === selectedPeriodId ? 'var(--ink-accent)' : 'var(--ink-border-subtle)',
                  background: period.id === selectedPeriodId ? 'var(--ink-accent-light)' : 'var(--ink-surface)',
                }}
                onClick={async () => {
                  setSelectedPeriodId(period.id);
                  await loadPeriod(period.id);
                  setShowPeriods(false);
                }}
              >
                <p className="font-medium">{period.label}</p>
                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
                  {period.year} · {space?.cadence === 'semi_monthly' ? `part ${period.periodIndex ?? '-'} ` : 'monthly'}
                </p>
              </button>
            ))}
          </div>
        </SimpleModal>
      )}

      {showLibraryManager && (
        <SimpleModal title="Expense Library" onClose={() => setShowLibraryManager(false)}>
          <div className="space-y-3">
            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--ink-border-subtle)' }}>
              <p className="mb-2 text-xs font-medium">{editingTemplate ? 'Edit item' : 'New item'}</p>
              <TemplateForm value={templateForm} onChange={setTemplateForm} categories={categories} />
              <div className="mt-3 flex justify-end gap-2">
                {editingTemplate && (
                  <button
                    className="z-btn"
                    onClick={() => {
                      setEditingTemplate(null);
                      setTemplateForm(emptyTemplateForm());
                    }}
                  >
                    Cancel edit
                  </button>
                )}
                <button className="z-btn z-btn-primary" onClick={saveTemplate} disabled={saving}>
                  {editingTemplate ? 'Save' : 'Add'}
                </button>
              </div>
            </div>

            <div className="space-y-2 max-h-[42vh] overflow-y-auto">
              {library.length === 0 && (
                <p className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>
                  No library items yet.
                </p>
              )}
              {library.map((template) => (
                <div key={template.id} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--ink-border-subtle)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{template.name}</p>
                      <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
                        {amountText(template.defaultAmount)} · {template.defaultPeriodSlot} · {template.recurrence}
                        {template.dueDay ? ` · due ${template.dueDay}` : ''}
                        {template.category ? ` · ${template.category}` : ''}
                        {!template.active ? ' · inactive' : ''}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <button className="z-btn z-btn-xs" onClick={() => startTemplateEdit(template)}>Edit</button>
                      {template.active && (
                        <button className="z-btn z-btn-xs" onClick={() => disableTemplate(template)}>Disable</button>
                      )}
                      <button
                        className="z-btn z-btn-xs"
                        onClick={() => deleteTemplate(template)}
                        style={{ color: 'var(--ink-danger, #c44)' }}
                        title="Permanently delete"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SimpleModal>
      )}

      {editingItem && (
        <SimpleModal title="Edit item" onClose={() => setEditingItem(null)}>
          <ItemForm
            value={editingItemForm}
            onChange={setEditingItemForm}
            onSubmit={saveItemEdit}
            submitLabel="Save changes"
            saving={saving}
            categories={categories}
          />
        </SimpleModal>
      )}

      {selectedAmountIds.size > 0 && (
        <div
          className="fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border px-4 py-2 shadow-lg"
          style={{
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
            background: 'var(--ink-surface)',
            borderColor: 'var(--ink-border-subtle)',
          }}
        >
          <span className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
            {selectedAmountIds.size} selected
          </span>
          <span className="text-sm font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
            ₡{amountText(selectedAmountTotal)}
          </span>
          <button
            type="button"
            onClick={clearAmountSelect}
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={{ background: 'var(--ink-subtle)', color: 'var(--ink-text-secondary)' }}
          >
            Clear
          </button>
        </div>
      )}
    </AuthShell>
  );
}

function ItemRow({
  item,
  compact = false,
  exchangeRate,
  onTogglePaid,
  onEdit,
  onDelete,
  selected = false,
  onToggleSelect,
}: {
  item: BudgetItem;
  compact?: boolean;
  exchangeRate?: number;
  onTogglePaid: (item: BudgetItem) => void;
  onEdit: (item: BudgetItem) => void;
  onDelete: (itemId: string) => void;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const amt = Number(item.amount);
  const isUsd = detectCurrency(amt) === 'USD';
  const crcEquivalent = isUsd && exchangeRate && exchangeRate > 0 ? amt * exchangeRate : null;
  return (
    <div className={`${compact ? 'mb-1 px-2 py-1.5' : 'mb-1.5 px-2.5 py-2'} rounded-lg transition-colors`} style={{ background: item.paid ? 'var(--ink-subtle)' : 'transparent' }}>
      <div className="flex items-center gap-2">
        <button
          className="task-checkbox"
          data-checked={item.paid}
          onClick={() => onTogglePaid(item)}
          aria-label={item.paid ? 'Mark unpaid' : 'Mark paid'}
        >
          {item.paid ? <Check size={12} strokeWidth={3} /> : null}
        </button>
        <div className="min-w-0 flex-1">
          <p className={`truncate ${compact ? 'text-xs' : 'text-sm'} font-medium`} style={{ textDecoration: item.paid ? 'line-through' : 'none' }}>
            {item.name}
          </p>
          {item.dueDay ? (
            <p className="text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>due {item.dueDay}</p>
          ) : null}
        </div>
        <p className={`${compact ? 'text-xs' : 'text-sm'} font-medium whitespace-nowrap text-right`}>
          {crcEquivalent != null && (
            <span
              className={`${compact ? 'text-[10px]' : 'text-[11px]'} mr-1 font-normal`}
              style={{ color: 'var(--ink-text-muted)' }}
            >
              ({amountText(item.amount)})
            </span>
          )}
          <button
            type="button"
            onClick={() => onToggleSelect?.(item.id)}
            className="rounded-md px-1.5 py-0.5 transition-colors"
            style={{
              background: selected ? 'var(--ink-accent, #3b82f6)' : 'transparent',
              color: selected ? '#fff' : 'inherit',
              fontVariantNumeric: 'tabular-nums',
              cursor: 'pointer',
            }}
            aria-pressed={selected}
            title={selected ? 'Click to unselect' : 'Click to add to sum'}
          >
            {crcEquivalent != null ? amountText(crcEquivalent) : amountText(item.amount)}
          </button>
        </p>
        <button
          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--ink-subtle)]"
          onClick={() => onEdit(item)}
          aria-label={`Edit ${item.name}`}
          title="Edit"
        >
          <Pencil size={14} />
        </button>
        <button
          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--ink-subtle)]"
          onClick={() => onDelete(item.id)}
          aria-label={`Remove ${item.name}`}
          title="Remove"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function ItemForm({
  value,
  onChange,
  onSubmit,
  submitLabel,
  saving,
  categories,
}: {
  value: ItemFormState;
  onChange: (v: ItemFormState) => void;
  onSubmit: () => void;
  submitLabel: string;
  saving: boolean;
  categories?: BudgetCategory[];
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="z-label">Name</label>
        <input className="z-input mt-1" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="z-label">Amount</label>
          <input className="z-input mt-1" value={value.amount} onChange={(e) => onChange({ ...value, amount: e.target.value })} inputMode="numeric" />
        </div>
        <div>
          <label className="z-label">Due day</label>
          <input className="z-input mt-1" value={value.dueDay} onChange={(e) => onChange({ ...value, dueDay: e.target.value })} inputMode="numeric" placeholder="optional" />
        </div>
      </div>
      <div>
        <label className="z-label">Subsection</label>
        <input
          className="z-input mt-1"
          list="budget-categories-datalist"
          value={value.category}
          onChange={(e) => onChange({ ...value, category: e.target.value })}
          placeholder="e.g. Housing, Transport (optional)"
        />
        {categories && categories.length > 0 && (
          <datalist id="budget-categories-datalist">
            {categories.map((c) => <option key={c.id} value={c.name} />)}
          </datalist>
        )}
      </div>
      <div className="flex justify-end">
        <button className="z-btn z-btn-primary" onClick={onSubmit} disabled={saving}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function TemplateForm({
  value,
  onChange,
  categories,
}: {
  value: TemplateFormState;
  onChange: (v: TemplateFormState) => void;
  categories?: BudgetCategory[];
}) {
  return (
    <div className="space-y-2">
      <input
        className="z-input"
        placeholder="Name"
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
      />
      <input
        className="z-input"
        list="budget-template-categories-datalist"
        placeholder="Subsection (optional)"
        value={value.category}
        onChange={(e) => onChange({ ...value, category: e.target.value })}
      />
      {categories && categories.length > 0 && (
        <datalist id="budget-template-categories-datalist">
          {categories.map((c) => <option key={c.id} value={c.name} />)}
        </datalist>
      )}
      <div className="grid grid-cols-2 gap-2">
        <input
          className="z-input"
          placeholder="Amount"
          inputMode="numeric"
          value={value.defaultAmount}
          onChange={(e) => onChange({ ...value, defaultAmount: e.target.value })}
        />
        <input
          className="z-input"
          placeholder="Due day"
          inputMode="numeric"
          value={value.dueDay}
          onChange={(e) => onChange({ ...value, dueDay: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select className="z-select" value={value.defaultPeriodSlot} onChange={(e) => onChange({ ...value, defaultPeriodSlot: e.target.value as TemplatePeriodSlot })}>
          <option value="first">first</option>
          <option value="second">second</option>
          <option value="both">both</option>
          <option value="manual">manual</option>
        </select>
        <select className="z-select" value={value.recurrence} onChange={(e) => onChange({ ...value, recurrence: e.target.value as TemplateRecurrence })}>
          <option value="monthly">monthly</option>
          <option value="weekly">weekly</option>
          <option value="biweekly">biweekly</option>
          <option value="manual">manual</option>
        </select>
      </div>
    </div>
  );
}

function SimpleModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'var(--ink-overlay)' }} onClick={onClose}>
      <div className="z-overlay z-animate-in w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button className="z-btn z-btn-xs" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
