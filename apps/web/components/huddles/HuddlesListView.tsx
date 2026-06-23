'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import type { Huddle } from './types';

function formatDate(s: string | null) {
  if (!s) return '';
  const d = new Date(s);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function HuddlesListView() {
  const [huddles, setHuddles] = useState<Huddle[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'active' | 'draft' | 'closed'>('active');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api<{ huddles: Huddle[] }>('/huddles');
        if (!cancelled) setHuddles(data?.huddles ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = huddles.filter((f) => f.status === tab);

  return (
    <div className="max-w-5xl mx-auto px-5 sm:px-8 py-8 sm:py-12 w-full">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="z-page-title">Huddles</h1>
          <p className="z-body mt-2" style={{ color: 'var(--ink-text-secondary)', maxWidth: 520 }}>
            Structured conversations that turn discussion into progress.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/huddles/templates"
            className="z-btn z-btn-sm rounded-full whitespace-nowrap"
            style={{
              background: 'var(--ink-surface-raised)',
              color: 'var(--ink-text)',
              border: '1px solid var(--ink-border-subtle)',
              padding: '8px 14px',
              fontWeight: 550,
              fontSize: '0.875rem',
            }}
          >
            Templates
          </Link>
          <Link
            href="/huddles/new"
            className="z-btn z-btn-sm rounded-full whitespace-nowrap"
            style={{
              background: 'var(--ink-accent)', color: 'var(--ink-on-accent)',
              padding: '8px 16px', fontWeight: 550, fontSize: '0.875rem',
              boxShadow: 'var(--ink-shadow-sm)',
            }}
          >
            + Start a Huddle
          </Link>
        </div>
      </div>

      <div
        className="flex gap-1 mb-5 p-1 rounded-lg w-fit"
        style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}
      >
        {(['active', 'draft', 'closed'] as const).map((t) => {
          const count = huddles.filter((f) => f.status === t).length;
          const on = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 py-1.5 rounded-md text-[13px] transition-all"
              style={{
                background: on ? 'var(--ink-surface-raised)' : 'transparent',
                color: on ? 'var(--ink-text)' : 'var(--ink-text-muted)',
                fontWeight: on ? 600 : 450,
                boxShadow: on ? 'var(--ink-shadow-sm)' : 'none',
              }}
            >
              {t === 'active' ? 'Active' : t === 'draft' ? 'Upcoming' : 'Closed'}
              <span style={{ opacity: 0.55, marginLeft: 6 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="z-caption" style={{ color: 'var(--ink-text-muted)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <ul className="grid gap-2.5">
          {filtered.map((f) => (
            <li key={f.id}>
              <Link
                href={`/huddles/${f.id}`}
                className="block p-4 rounded-xl transition-all"
                style={{
                  background: 'var(--ink-surface)',
                  border: '1px solid var(--ink-border-subtle)',
                  boxShadow: 'var(--ink-shadow-sm)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--ink-surface-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--ink-surface)'; }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <HuddleTypeBadge type={f.type} />
                      <StatusDot status={f.status} />
                    </div>
                    <h3 className="text-[15px] font-semibold truncate" style={{ color: 'var(--ink-text)' }}>
                      {f.title}
                    </h3>
                    {f.intention && (
                      <p className="text-[13px] mt-1 line-clamp-2" style={{ color: 'var(--ink-text-secondary)' }}>
                        {f.intention}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[12px]" style={{ color: 'var(--ink-text-muted)' }}>
                      {formatDate(f.scheduledAt ?? f.createdAt)}
                    </div>
                    <div className="text-[11px] mt-1" style={{ color: 'var(--ink-text-faint)' }}>
                      {f.participantCount ?? 0} {(f.participantCount ?? 0) === 1 ? 'person' : 'people'}
                    </div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ tab }: { tab: string }) {
  return (
    <div
      className="text-center py-16 px-6 rounded-2xl"
      style={{ background: 'var(--ink-surface)', border: '1px dashed var(--ink-border-subtle)' }}
    >
      <div className="text-[32px] mb-3" style={{ opacity: 0.4 }}>◌</div>
      <h3 className="text-[15px] font-semibold mb-1" style={{ color: 'var(--ink-text)' }}>
        {tab === 'active' ? 'No active huddles' : tab === 'draft' ? 'Nothing scheduled' : 'No closed huddles yet'}
      </h3>
      <p className="text-[13px] mb-4" style={{ color: 'var(--ink-text-muted)' }}>
        Start one when alignment, clarity, or momentum matters.
      </p>
      <Link
        href="/huddles/new"
        className="inline-block px-4 py-2 rounded-full text-[13px]"
        style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)', fontWeight: 550 }}
      >
        Start a Huddle
      </Link>
    </div>
  );
}

export function HuddleTypeBadge({ type }: { type: 'team' | 'personal' }) {
  const isTeam = type === 'team';
  return (
    <span
      className="inline-flex items-center gap-1 text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{
        background: isTeam ? 'var(--ink-accent-light)' : 'var(--ink-surface-raised)',
        color: isTeam ? 'var(--ink-accent)' : 'var(--ink-text-secondary)',
        fontWeight: 600,
        letterSpacing: '0.06em',
      }}
    >
      {isTeam ? 'Team' : 'Personal'}
    </span>
  );
}

export function StatusDot({ status }: { status: 'draft' | 'active' | 'closed' }) {
  const color =
    status === 'active' ? 'var(--ink-in-progress)' :
    status === 'draft' ? 'var(--ink-text-faint)' : 'var(--ink-done)';
  const label = status === 'active' ? 'Live' : status === 'draft' ? 'Upcoming' : 'Closed';
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
      <span
        style={{
          width: 7, height: 7, borderRadius: '50%',
          background: color,
          boxShadow: status === 'active' ? `0 0 0 3px var(--ink-accent-subtle)` : 'none',
        }}
      />
      {label}
    </span>
  );
}
