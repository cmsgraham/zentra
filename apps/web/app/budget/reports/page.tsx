'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/layout/AuthShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { api } from '@/lib/api-client';
import { Trash2 } from 'lucide-react';

interface SnapshotListItem {
  id: string;
  year: number;
  month: number;
  incomeTotal: number;
  deductionTotal: number;
  expenseTotal: number;
  leftover: number;
  auto: boolean;
  createdAt: string;
}

interface SnapshotDetail extends SnapshotListItem {
  payload: any;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatCRC(n: number): string {
  return `₡${Math.round(n).toLocaleString('en-US')}`;
}

export default function ReportsPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [list, setList] = useState<SnapshotListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SnapshotDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api<SnapshotListItem[]>('/budget/monthly/snapshots');
      setList(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openSnapshot = useCallback(async (id: string) => {
    setOpenId(id);
    setDetailLoading(true);
    setDetail(null);
    try {
      const d = await api<SnapshotDetail>(`/budget/monthly/snapshots/${id}`);
      setDetail(d);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  async function deleteSnapshot(id: string) {
    if (!window.confirm('Delete this snapshot?')) return;
    await api(`/budget/monthly/snapshots/${id}`, { method: 'DELETE' });
    if (openId === id) { setOpenId(null); setDetail(null); }
    await load();
  }

  return (
    <AuthShell>
      <div className={`mx-auto max-w-2xl ${isMobile ? 'px-4 pb-24 pt-3' : 'px-6 py-6'}`}>
        <div className="mb-4 flex items-center justify-between">
          <button className="z-btn z-btn-sm" onClick={() => router.push('/budget/monthly')}>← Monthly</button>
        </div>
        <h1 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--ink-text)' }}>Budget Reports</h1>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-text-muted)' }}>
          Snapshots of past months. Use the “Snapshot” button on Monthly Planning to capture the current month.
        </p>

        {loading && <p className="mt-6 text-sm" style={{ color: 'var(--ink-text-muted)' }}>Loading…</p>}
        {!loading && list.length === 0 && (
          <p className="mt-6 text-sm" style={{ color: 'var(--ink-text-muted)' }}>No snapshots yet.</p>
        )}

        <div className="mt-4 space-y-2">
          {list.map((s) => (
            <div
              key={s.id}
              className="rounded-2xl border"
              style={{ borderColor: 'var(--ink-border-subtle)', background: 'var(--ink-surface)', boxShadow: 'var(--ink-shadow-sm)' }}
            >
              <div
                role="button"
                tabIndex={0}
                className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left"
                onClick={() => openId === s.id ? setOpenId(null) : openSnapshot(s.id)}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openId === s.id ? setOpenId(null) : openSnapshot(s.id); } }}
                aria-expanded={openId === s.id}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" style={{ color: 'var(--ink-text)' }}>
                    {MONTH_NAMES[s.month - 1]} {s.year}
                    {s.auto && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-text-faint)' }}>auto</span>
                    )}
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
                    {new Date(s.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm tabular-nums" style={{ color: s.leftover >= 0 ? 'var(--ink-text)' : '#dc2626' }}>
                    {formatCRC(s.leftover)}
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>leftover</p>
                </div>
                <button
                  className="z-btn z-btn-sm ml-2 text-red-600"
                  onClick={(ev) => { ev.stopPropagation(); deleteSnapshot(s.id); }}
                  aria-label="Delete snapshot"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {openId === s.id && (
                <div className="border-t px-4 py-3 text-sm" style={{ borderColor: 'var(--ink-border-subtle)' }}>
                  {detailLoading && <p style={{ color: 'var(--ink-text-muted)' }}>Loading…</p>}
                  {!detailLoading && detail && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        <span style={{ color: 'var(--ink-text-secondary)' }}>Income</span>
                        <span className="text-right tabular-nums">{formatCRC(detail.incomeTotal)}</span>
                        <span style={{ color: 'var(--ink-text-secondary)' }}>− Deductions</span>
                        <span className="text-right tabular-nums">{formatCRC(detail.deductionTotal)}</span>
                        <span style={{ color: 'var(--ink-text-secondary)' }}>− Planned</span>
                        <span className="text-right tabular-nums">{formatCRC(detail.expenseTotal)}</span>
                      </div>
                      <SectionList title="Income" entries={(detail.payload?.entries ?? []).filter((e: any) => e.kind === 'income')} />
                      <SectionList title="Deductions" entries={(detail.payload?.entries ?? []).filter((e: any) => e.kind === 'deduction')} />
                      <SpacesList spaces={detail.payload?.spaces ?? []} />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </AuthShell>
  );
}

function SectionList({ title, entries }: { title: string; entries: any[] }) {
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium" style={{ color: 'var(--ink-text-secondary)' }}>{title}</p>
      <div className="divide-y" style={{ borderColor: 'var(--ink-border-subtle)' }}>
        {entries.map((e) => (
          <div key={e.id} className="flex items-center justify-between py-1">
            <span className="truncate text-xs" style={{ color: 'var(--ink-text)' }}>{e.label}</span>
            <span className="text-xs tabular-nums" style={{ color: 'var(--ink-text-secondary)' }}>{formatCRC(e.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SpacesList({ spaces }: { spaces: any[] }) {
  if (!spaces || spaces.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium" style={{ color: 'var(--ink-text-secondary)' }}>Budget Spaces</p>
      <div className="space-y-2">
        {spaces.map((s: any) => (
          <div key={s.id} className="rounded-md border px-2 py-1.5" style={{ borderColor: 'var(--ink-border-subtle)' }}>
            <div className="flex items-center justify-between">
              <span className="truncate text-xs font-medium" style={{ color: 'var(--ink-text)' }}>{s.name}</span>
              <span className="text-xs tabular-nums" style={{ color: 'var(--ink-text-secondary)' }}>{formatCRC(s.monthTotal)}</span>
            </div>
            {Array.isArray(s.items) && s.items.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {s.items.map((it: any) => (
                  <div key={it.id} className="flex items-center justify-between pl-2 text-[11px]">
                    <span className="truncate" style={{ color: 'var(--ink-text-muted)' }}>{it.name}</span>
                    <span className="tabular-nums" style={{ color: 'var(--ink-text-muted)' }}>{formatCRC(it.amountCrc ?? it.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
