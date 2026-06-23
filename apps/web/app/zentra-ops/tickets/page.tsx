'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

interface Ticket {
  id: string;
  category: string;
  subject: string;
  message: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'normal' | 'high';
  staff_response: string | null;
  responded_at: string | null;
  created_at: string;
  user_email: string;
  user_name: string;
}

export default function TicketsPage() {
  const [items, setItems] = useState<Ticket[]>([]);
  const [status, setStatus] = useState<'all' | 'open' | 'in_progress' | 'resolved' | 'closed'>('open');
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await api<{ items: Ticket[] }>(`/zentra-ops/tickets?status=${status}&limit=100`);
    setItems(r.items);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  async function update(id: string, body: any) {
    setBusy(true);
    try {
      await api(`/zentra-ops/tickets/${id}`, { method: 'PATCH', body });
      await load();
      if (selected?.id === id) setSelected(null);
      setResponse('');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Support tickets</h1>
      </div>

      <div className="flex gap-2">
        {(['open', 'in_progress', 'resolved', 'closed', 'all'] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className="px-3 py-1.5 rounded-lg text-xs"
            style={{
              background: status === s ? 'var(--ink-accent)' : 'var(--ink-surface)',
              color: status === s ? 'white' : 'var(--ink-text)',
              border: '1px solid var(--ink-border)',
            }}>
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
          <div className="divide-y" style={{ borderColor: 'var(--ink-border)' }}>
            {items.length === 0 && <div className="p-6 text-sm text-center" style={{ color: 'var(--ink-text-muted)' }}>No tickets</div>}
            {items.map((t) => (
              <button key={t.id} onClick={() => { setSelected(t); setResponse(t.staff_response || ''); }}
                className="w-full text-left p-4 transition-colors"
                style={{ background: selected?.id === t.id ? 'var(--ink-subtle)' : 'transparent' }}>
                <div className="flex justify-between items-start gap-2">
                  <div className="font-medium text-sm truncate">{t.subject}</div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                    style={{ background: 'var(--ink-subtle)', color: 'var(--ink-text-muted)' }}>{t.status}</span>
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--ink-text-muted)' }}>
                  {t.user_email} · {t.category} · {new Date(t.created_at).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl p-5 sticky top-4 self-start" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
          {!selected && <p className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>Select a ticket to view details</p>}
          {selected && (
            <div className="space-y-4">
              <div>
                <h2 className="font-semibold">{selected.subject}</h2>
                <div className="text-xs mt-1" style={{ color: 'var(--ink-text-muted)' }}>
                  {selected.user_name} · {selected.user_email}
                </div>
              </div>
              <div className="text-sm whitespace-pre-wrap p-3 rounded-lg" style={{ background: 'var(--ink-bg)' }}>
                {selected.message}
              </div>
              <div>
                <label className="text-xs font-medium" style={{ color: 'var(--ink-text-muted)' }}>Staff response</label>
                <textarea value={response} onChange={(e) => setResponse(e.target.value)} rows={4}
                  className="w-full mt-1 px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-bg)' }} />
              </div>
              <div className="flex gap-2 flex-wrap">
                <button disabled={busy} onClick={() => update(selected.id, { status: 'in_progress', staffResponse: response || undefined })}
                  className="text-xs px-3 py-1.5 rounded-lg" style={{ border: '1px solid var(--ink-border)' }}>
                  Mark in progress
                </button>
                <button disabled={busy} onClick={() => update(selected.id, { status: 'resolved', staffResponse: response || undefined })}
                  className="text-xs px-3 py-1.5 rounded-lg text-white" style={{ background: 'var(--ink-accent)' }}>
                  Resolve
                </button>
                <button disabled={busy} onClick={() => update(selected.id, { status: 'closed' })}
                  className="text-xs px-3 py-1.5 rounded-lg" style={{ border: '1px solid var(--ink-border)' }}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
