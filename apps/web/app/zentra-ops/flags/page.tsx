'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

interface Flag {
  key: string;
  enabled: boolean;
  description: string | null;
  rollout_pct: number | null;
  updated_at: string;
}

export default function FlagsPage() {
  const [items, setItems] = useState<Flag[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await api<{ items: Flag[] }>('/zentra-ops/flags');
    setItems(r.items);
  }
  useEffect(() => { load(); }, []);

  async function save(key: string, body: { enabled: boolean; description?: string; rolloutPct?: number }) {
    setBusy(true);
    try {
      await api(`/zentra-ops/flags/${encodeURIComponent(key)}`, { method: 'PUT', body });
      await load();
    } finally { setBusy(false); }
  }
  async function del(key: string) {
    if (!confirm(`Delete flag "${key}"?`)) return;
    await api(`/zentra-ops/flags/${encodeURIComponent(key)}`, { method: 'DELETE' });
    await load();
  }

  async function create() {
    if (!newKey.trim()) return;
    await save(newKey.trim(), { enabled: false, description: newDesc.trim() || undefined, rolloutPct: 0 });
    setNewKey(''); setNewDesc('');
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Feature flags</h1>

      <div className="rounded-xl p-5 space-y-3" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
        <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ink-text-muted)' }}>New flag</div>
        <div className="flex gap-2">
          <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="flag.key"
            className="flex-1 px-3 py-2 rounded-lg text-sm font-mono outline-none"
            style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-bg)' }} />
          <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Description"
            className="flex-[2] px-3 py-2 rounded-lg text-sm outline-none"
            style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-bg)' }} />
          <button onClick={create} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: 'var(--ink-accent)' }}>Create</button>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-widest" style={{ color: 'var(--ink-text-muted)' }}>
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Rollout %</th>
              <th className="px-4 py-3">Enabled</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center" style={{ color: 'var(--ink-text-muted)' }}>No flags</td></tr>}
            {items.map((f) => (
              <tr key={f.key} style={{ borderTop: '1px solid var(--ink-border)' }}>
                <td className="px-4 py-3 font-mono text-xs">{f.key}</td>
                <td className="px-4 py-3 text-xs" style={{ color: 'var(--ink-text-muted)' }}>{f.description || '—'}</td>
                <td className="px-4 py-3">
                  <input type="number" min={0} max={100} defaultValue={f.rollout_pct ?? 0}
                    onBlur={(e) => save(f.key, { enabled: f.enabled, rolloutPct: Number(e.target.value) })}
                    className="w-20 px-2 py-1 rounded text-xs"
                    style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-bg)' }} />
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => save(f.key, { enabled: !f.enabled })} disabled={busy}
                    className="text-xs px-3 py-1 rounded"
                    style={{
                      background: f.enabled ? 'var(--ink-accent)' : 'var(--ink-subtle)',
                      color: f.enabled ? 'white' : 'var(--ink-text)',
                    }}>
                    {f.enabled ? 'On' : 'Off'}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => del(f.key)} className="text-xs" style={{ color: 'var(--ink-blocked)' }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
