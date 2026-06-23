'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

interface Sec {
  recentFailed: { email: string; ip: string; failure_reason: string; provider: string; created_at: string }[];
  topFailedIps: { ip: string; attempts: number }[];
  providers: { provider: string; success: number; failed: number }[];
  suspended: { id: string; email: string; suspended_at: string; suspended_reason: string | null }[];
}

export default function SecurityPage() {
  const [data, setData] = useState<Sec | null>(null);
  useEffect(() => { api<Sec>('/zentra-ops/security').then(setData); }, []);
  if (!data) return <p className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>Loading…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Security</h1>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--ink-text-muted)' }}>Login providers · 7d</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {data.providers.map((p) => (
            <div key={p.provider} className="rounded-xl p-4" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
              <div className="text-xs uppercase tracking-widest" style={{ color: 'var(--ink-text-muted)' }}>{p.provider}</div>
              <div className="text-sm mt-1">✓ <strong>{p.success}</strong> · ✗ <strong style={{ color: 'var(--ink-blocked)' }}>{p.failed}</strong></div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--ink-text-muted)' }}>Top failing IPs · 24h</h2>
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
          <table className="w-full text-sm">
            <tbody>
              {data.topFailedIps.length === 0 && <tr><td className="p-4 text-center" style={{ color: 'var(--ink-text-muted)' }}>None</td></tr>}
              {data.topFailedIps.map((r) => (
                <tr key={r.ip} style={{ borderTop: '1px solid var(--ink-border)' }}>
                  <td className="px-4 py-2 font-mono text-xs">{r.ip}</td>
                  <td className="px-4 py-2 text-right text-xs">{r.attempts} attempts</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--ink-text-muted)' }}>Recent failed logins</h2>
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest" style={{ color: 'var(--ink-text-muted)' }}>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">IP</th>
              </tr>
            </thead>
            <tbody>
              {data.recentFailed.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--ink-border)' }}>
                  <td className="px-4 py-2 text-xs">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2 text-xs">{r.email}</td>
                  <td className="px-4 py-2 text-xs">{r.provider}</td>
                  <td className="px-4 py-2 text-xs">{r.failure_reason}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--ink-text-muted)' }}>Suspended accounts</h2>
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
          <table className="w-full text-sm">
            <tbody>
              {data.suspended.length === 0 && <tr><td className="p-4 text-center" style={{ color: 'var(--ink-text-muted)' }}>None</td></tr>}
              {data.suspended.map((u) => (
                <tr key={u.id} style={{ borderTop: '1px solid var(--ink-border)' }}>
                  <td className="px-4 py-2 text-xs">{u.email}</td>
                  <td className="px-4 py-2 text-xs">{u.suspended_reason || '—'}</td>
                  <td className="px-4 py-2 text-xs text-right">{new Date(u.suspended_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
