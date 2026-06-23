'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

interface Entry {
  id: string;
  actor_email: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: any;
  ip: string | null;
  created_at: string;
}

export default function AuditPage() {
  const [items, setItems] = useState<Entry[]>([]);
  const [filter, setFilter] = useState('');

  async function load() {
    const url = filter ? `/zentra-ops/audit?action=${encodeURIComponent(filter)}` : '/zentra-ops/audit';
    const r = await api<{ items: Entry[] }>(url);
    setItems(r.items);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--ink-text-muted)' }}>Every admin action is recorded.</p>
      </div>

      <div className="flex gap-2">
        <input value={filter} onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          placeholder="Filter by action prefix (e.g. user. or broadcast.)"
          className="flex-1 px-4 py-2 rounded-lg text-sm outline-none"
          style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)' }} />
        <button onClick={load} className="px-4 py-2 rounded-lg text-sm font-medium text-white"
          style={{ background: 'var(--ink-accent)' }}>Filter</button>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-widest" style={{ color: 'var(--ink-text-muted)' }}>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Metadata</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center" style={{ color: 'var(--ink-text-muted)' }}>No entries</td></tr>}
            {items.map((e) => (
              <tr key={e.id} style={{ borderTop: '1px solid var(--ink-border)' }}>
                <td className="px-4 py-2 text-xs">{new Date(e.created_at).toLocaleString()}</td>
                <td className="px-4 py-2 text-xs">{e.actor_email}</td>
                <td className="px-4 py-2 text-xs font-mono">{e.action}</td>
                <td className="px-4 py-2 text-xs">{e.target_type ? `${e.target_type}:${e.target_id?.slice(0, 8)}` : '—'}</td>
                <td className="px-4 py-2 text-xs font-mono" style={{ color: 'var(--ink-text-muted)' }}>
                  {e.metadata ? JSON.stringify(e.metadata).slice(0, 80) : '—'}
                </td>
                <td className="px-4 py-2 text-xs font-mono">{e.ip || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
