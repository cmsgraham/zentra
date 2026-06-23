'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

interface Overview {
  users: { total: number; active30d: number; signups7d: number; signups30d: number; dau: number; wau: number; mau: number };
  content: { workspaces: number; tasks: number; tasks_done: number; appointments: number; shopping_lists: number; reflections: number };
  tickets: { open: number; in_progress: number; resolved: number; total: number };
  ai24h: { calls: number; input_tokens: number; output_tokens: number; errors: number };
  logins24h: { success: number; failed: number; failed_unique_emails: number };
}

interface Point { day: string; value: number }

function Card({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div
      className="rounded-xl p-3 md:p-5 min-w-0"
      style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}
    >
      <div
        className="text-[10px] md:text-[11px] font-medium uppercase tracking-wider md:tracking-widest leading-tight break-words"
        style={{ color: 'var(--ink-text-muted)' }}
      >
        {label}
      </div>
      <div className="text-xl md:text-2xl font-semibold mt-1.5 tabular-nums">{value}</div>
      {hint && <div className="text-[11px] md:text-xs mt-1" style={{ color: 'var(--ink-text-muted)' }}>{hint}</div>}
    </div>
  );
}

function Sparkline({ points }: { points: Point[] }) {
  if (points.length === 0) {
    return <div className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>No data</div>;
  }
  const max = Math.max(...points.map(p => p.value), 1);
  const w = 600;
  const h = 80;
  const step = w / Math.max(points.length - 1, 1);
  const pts = points.map((p, i) => `${i * step},${h - (p.value / max) * h}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20">
      <polyline points={pts} fill="none" stroke="var(--ink-accent)" strokeWidth="2" />
    </svg>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [signups, setSignups] = useState<Point[]>([]);
  const [logins, setLogins] = useState<Point[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [d, s, l] = await Promise.all([
          api<Overview>('/zentra-ops/overview'),
          api<{ points: Point[] }>('/zentra-ops/timeseries?metric=signups&days=30'),
          api<{ points: Point[] }>('/zentra-ops/timeseries?metric=logins&days=30'),
        ]);
        setData(d);
        setSignups(s.points);
        setLogins(l.points);
      } catch (err: any) {
        setError(err?.message || 'Failed to load');
      }
    })();
  }, []);

  if (error) return <p className="text-sm" style={{ color: 'var(--ink-blocked)' }}>{error}</p>;
  if (!data) return <p className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>Loading…</p>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--ink-text-muted)' }}>
          Privacy-first metrics. No user content is exposed here — only counts and metadata.
        </p>
      </div>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--ink-text-muted)' }}>
          Users
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 md:gap-3">
          <Card label="Total active" value={data.users.total} />
          <Card label="DAU" value={data.users.dau} hint="last 24h" />
          <Card label="WAU" value={data.users.wau} hint="last 7d" />
          <Card label="MAU" value={data.users.mau} hint="last 30d" />
          <Card label="Signups 7d" value={data.users.signups7d} />
          <Card label="Signups 30d" value={data.users.signups30d} />
          <Card label="Active 30d" value={data.users.active30d} />
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--ink-text-muted)' }}>
          Content (counts only)
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-3">
          <Card label="Spaces" value={data.content.workspaces} />
          <Card label="Intentions" value={data.content.tasks} />
          <Card label="Done" value={data.content.tasks_done} />
          <Card label="Appointments" value={data.content.appointments} />
          <Card label="Lists" value={data.content.shopping_lists} />
          <Card label="Echoes" value={data.content.reflections} />
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl p-5" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
          <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--ink-text-muted)' }}>
            Signups · last 30 days
          </div>
          <Sparkline points={signups} />
        </div>
        <div className="rounded-xl p-5" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
          <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--ink-text-muted)' }}>
            Successful logins · last 30 days
          </div>
          <Sparkline points={logins} />
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-4">
        <div className="rounded-xl p-5" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
          <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--ink-text-muted)' }}>
            Tickets
          </div>
          <div className="text-sm space-y-1">
            <div>Open: <strong>{data.tickets.open}</strong></div>
            <div>In progress: <strong>{data.tickets.in_progress}</strong></div>
            <div>Resolved: <strong>{data.tickets.resolved}</strong></div>
            <div>Total: <strong>{data.tickets.total}</strong></div>
          </div>
        </div>
        <div className="rounded-xl p-5" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
          <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--ink-text-muted)' }}>
            AI · last 24h
          </div>
          <div className="text-sm space-y-1">
            <div>Calls: <strong>{data.ai24h.calls}</strong></div>
            <div>Input tokens: <strong>{data.ai24h.input_tokens.toLocaleString()}</strong></div>
            <div>Output tokens: <strong>{data.ai24h.output_tokens.toLocaleString()}</strong></div>
            <div>Errors: <strong>{data.ai24h.errors}</strong></div>
          </div>
        </div>
        <div className="rounded-xl p-5" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
          <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--ink-text-muted)' }}>
            Logins · last 24h
          </div>
          <div className="text-sm space-y-1">
            <div>Successful: <strong>{data.logins24h.success}</strong></div>
            <div>Failed: <strong style={{ color: data.logins24h.failed > 50 ? 'var(--ink-blocked)' : undefined }}>{data.logins24h.failed}</strong></div>
            <div>Unique emails (failed): <strong>{data.logins24h.failed_unique_emails}</strong></div>
          </div>
        </div>
      </section>
    </div>
  );
}
