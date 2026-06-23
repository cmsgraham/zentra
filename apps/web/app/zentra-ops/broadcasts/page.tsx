'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

interface Broadcast {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  active: boolean;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
}

export default function BroadcastsPage() {
  const [items, setItems] = useState<Broadcast[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>('info');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await api<{ items: Broadcast[] }>('/zentra-ops/broadcasts');
    setItems(r.items);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    try {
      await api('/zentra-ops/broadcasts', {
        method: 'POST',
        body: {
          title: title.trim(),
          body: body.trim(),
          severity,
          endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
        },
      });
      setTitle(''); setBody(''); setEndsAt(''); setSeverity('info');
      await load();
    } finally { setBusy(false); }
  }

  async function toggle(id: string, active: boolean) {
    await api(`/zentra-ops/broadcasts/${id}`, { method: 'PATCH', body: { active } });
    await load();
  }
  async function del(id: string) {
    if (!confirm('Delete broadcast?')) return;
    await api(`/zentra-ops/broadcasts/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Broadcasts</h1>

      <div className="rounded-xl p-5 space-y-3" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
        <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ink-text-muted)' }}>New broadcast</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title"
          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-bg)' }} />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message body" rows={3}
          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-bg)' }} />
        <div className="flex gap-2 items-center">
          <select value={severity} onChange={(e) => setSeverity(e.target.value as any)}
            className="px-3 py-2 rounded-lg text-sm"
            style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-bg)' }}>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
          <label className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>Ends at:</label>
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm"
            style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-bg)' }} />
          <button onClick={create} disabled={busy || !title.trim() || !body.trim()}
            className="ml-auto px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: 'var(--ink-accent)' }}>
            Publish
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {items.length === 0 && <p className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>No broadcasts yet</p>}
        {items.map((b) => (
          <div key={b.id} className="rounded-xl p-5" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
            <div className="flex justify-between items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded"
                    style={{
                      background: b.severity === 'critical' ? 'var(--ink-blocked)' : b.severity === 'warning' ? '#f59e0b' : 'var(--ink-subtle)',
                      color: b.severity === 'info' ? 'var(--ink-text)' : 'white',
                    }}>{b.severity}</span>
                  <h3 className="font-semibold">{b.title}</h3>
                  {!b.active && <span className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>(inactive)</span>}
                </div>
                <p className="text-sm mt-2 whitespace-pre-wrap">{b.body}</p>
                <div className="text-xs mt-2" style={{ color: 'var(--ink-text-muted)' }}>
                  Starts {new Date(b.starts_at).toLocaleString()}
                  {b.ends_at && ` · Ends ${new Date(b.ends_at).toLocaleString()}`}
                </div>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <button onClick={() => toggle(b.id, !b.active)} className="text-xs px-3 py-1 rounded"
                  style={{ border: '1px solid var(--ink-border)' }}>
                  {b.active ? 'Deactivate' : 'Activate'}
                </button>
                <button onClick={() => del(b.id)} className="text-xs px-3 py-1 rounded"
                  style={{ border: '1px solid var(--ink-blocked)', color: 'var(--ink-blocked)' }}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
