'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/layout/AuthShell';
import FloatingActionButton from '@/components/mobile/FloatingActionButton';
import { useIsMobile } from '@/lib/useIsMobile';
import { type BudgetCadence, useBudgetStore } from '@/lib/useBudgetStore';

function amountText(amount: number): string {
  return String(Math.round(amount));
}

function cadenceText(cadence: BudgetCadence): string {
  if (cadence === 'none') return 'Future purchases';
  if (cadence === 'monthly') return 'Monthly';
  return 'Semi-monthly';
}

export default function BudgetHomePage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const spaces = useBudgetStore((s) => s.spaces);
  const loadingSpaces = useBudgetStore((s) => s.loadingSpaces);
  const loadSpaces = useBudgetStore((s) => s.loadSpaces);
  const createSpace = useBudgetStore((s) => s.createSpace);
  const deleteSpace = useBudgetStore((s) => s.deleteSpace);

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<BudgetCadence>('semi_monthly');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadSpaces();
  }, [loadSpaces]);

  const ordered = useMemo(
    () => [...spaces].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [spaces],
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const created = await createSpace({ name: name.trim(), cadence });
      setShowCreate(false);
      setName('');
      router.push(`/budget/${created.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(e: React.MouseEvent, space: { id: string; name: string }) {
    e.stopPropagation();
    const confirmed = window.confirm(
      `Delete budget space "${space.name}"? This will permanently remove all its periods, items, and expense library. This cannot be undone.`,
    );
    if (!confirmed) return;
    await deleteSpace(space.id);
  }

  return (
    <AuthShell>
      <div className={`mx-auto max-w-3xl ${isMobile ? 'px-4 pb-24 pt-3' : 'px-6 py-6'}`}>
        {!isMobile && (
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="z-page-title">Budget</h1>
              <p className="z-caption mt-1">Quiet planning for pay periods and future purchases.</p>
            </div>
            <div className="flex items-center gap-2">
              <button className="z-btn" onClick={() => router.push('/budget/monthly')}>
                Monthly Planning
              </button>
              <button className="z-btn" onClick={() => router.push('/budget/deductions')}>
                Deductions
              </button>
              <button className="z-btn z-btn-primary" onClick={() => setShowCreate(true)}>
                New Space
              </button>
            </div>
          </div>
        )}

        {isMobile && (
          <>
            <button
              className="mb-3 w-full rounded-xl border px-4 py-3 text-left text-sm"
              style={{ borderColor: 'var(--ink-border-subtle)', background: 'var(--ink-surface)', color: 'var(--ink-text)' }}
              onClick={() => router.push('/budget/monthly')}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">Monthly Planning</span>
                <span style={{ color: 'var(--ink-text-faint)' }}>→</span>
              </div>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-text-muted)' }}>
                Income, deductions, and tagged spaces.
              </p>
            </button>
            <button
              className="mb-3 w-full rounded-xl border px-4 py-3 text-left text-sm"
              style={{ borderColor: 'var(--ink-border-subtle)', background: 'var(--ink-surface)', color: 'var(--ink-text)' }}
              onClick={() => router.push('/budget/deductions')}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">Deductions</span>
                <span style={{ color: 'var(--ink-text-faint)' }}>→</span>
              </div>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-text-muted)' }}>
                Library of recurring deductions (CCSS, Renta, garnishment, custom).
              </p>
            </button>
          </>
        )}

        {loadingSpaces && ordered.length === 0 && (
          <div className="rounded-xl border p-5 text-sm" style={{ borderColor: 'var(--ink-border-subtle)', color: 'var(--ink-text-muted)' }}>
            Loading spaces...
          </div>
        )}

        {!loadingSpaces && ordered.length === 0 && (
          <div className="rounded-2xl border px-5 py-10 text-center" style={{ borderColor: 'var(--ink-border-subtle)', background: 'var(--ink-surface)' }}>
            <p className="text-base font-medium">No Budget Spaces yet</p>
            <p className="z-caption mt-2">Create a space like Home, Personal, Business, or Travel.</p>
            <button className="z-btn z-btn-primary mt-5" onClick={() => setShowCreate(true)}>
              Create Space
            </button>
          </div>
        )}

        <div className="space-y-3">
          {ordered.map((space) => (
            <div
              key={space.id}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/budget/${space.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  router.push(`/budget/${space.id}`);
                }
              }}
              className="w-full cursor-pointer rounded-2xl border px-4 py-4 text-left transition-all hover:scale-[1.004]"
              style={{
                borderColor: 'var(--ink-border-subtle)',
                background: 'var(--ink-surface)',
                boxShadow: 'var(--ink-shadow-sm)',
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[1rem] font-semibold">{space.name}</p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--ink-text-muted)' }}>
                    {space.cadence === 'none' ? 'No cadence' : space.currentPeriod?.label ?? 'Current period'}
                  </p>
                  {space.ownerName && (
                    <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-text-faint)' }}>
                      {space.isOwner ? 'Owner: You' : `Owner: ${space.ownerName}`}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {space.isOwner && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Delete ${space.name}`}
                      title="Delete space"
                      onClick={(e) => handleDelete(e, space)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleDelete(e as unknown as React.MouseEvent, space);
                        }
                      }}
                      className="rounded-md p-1.5 text-red-500 transition-colors hover:bg-red-50"
                      style={{ color: 'var(--ink-text-faint)' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                        <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                      </svg>
                    </span>
                  )}
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--ink-text-faint)' }}>
                    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]" style={{ color: 'var(--ink-text-secondary)' }}>
                <span className="rounded-full px-2.5 py-1" style={{ background: 'var(--ink-subtle)' }}>
                  {space.summary?.unpaidCount ?? 0} unpaid
                </span>
                <span className="rounded-full px-2.5 py-1" style={{ background: 'var(--ink-subtle)' }}>
                  {space.summary?.plannedCount ?? 0} {space.cadence === 'none' ? 'pending' : 'planned'}
                </span>
                <span className="rounded-full px-2.5 py-1" style={{ background: 'var(--ink-subtle)' }}>
                  {cadenceText(space.cadence)}
                </span>
                <span className="rounded-full px-2.5 py-1" style={{ background: 'var(--ink-subtle)' }}>
                  {amountText(space.summary?.totalAmount ?? 0)} total
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'var(--ink-overlay)' }}
          onClick={() => setShowCreate(false)}
        >
          <form
            className="z-overlay z-animate-in w-full max-w-sm space-y-4 p-5"
            onSubmit={handleCreate}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold">New Budget Space</h2>
            <div>
              <label className="z-label">Name</label>
              <input className="z-input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Home" autoFocus />
            </div>
            <div>
              <label className="z-label">Cadence</label>
              <select className="z-select mt-1" value={cadence} onChange={(e) => setCadence(e.target.value as BudgetCadence)}>
                <option value="semi_monthly">Semi-monthly (1-15, 16-end)</option>
                <option value="monthly">Monthly</option>
                <option value="none">No cadence (future purchases)</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="z-btn" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button type="submit" className="z-btn z-btn-primary" disabled={creating}>
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      {isMobile && (
        <FloatingActionButton
          actions={[{ label: 'New Space', icon: '+', onClick: () => setShowCreate(true) }]}
        />
      )}
    </AuthShell>
  );
}
