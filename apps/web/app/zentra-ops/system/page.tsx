'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

interface Sys {
  node: { version: string; uptimeSec: number; memory: { rss: number; heapUsed: number; heapTotal: number; external: number } };
  os: { platform: string; arch: string; hostname: string; uptimeSec: number; cpus: number; cpuModel: string; loadAvg: number[]; memTotal: number; memFree: number; memUsed: number };
  disk: { total: number; free: number; used: number } | null;
  db: { bytes: number; connections: number };
}

function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
function dur(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function Bar({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total > 0 ? (used / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span style={{ color: 'var(--ink-text-muted)' }}>{label}</span>
        <span>{bytes(used)} / {bytes(total)} ({pct.toFixed(0)}%)</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--ink-subtle)' }}>
        <div className="h-full" style={{ width: `${pct}%`, background: pct > 85 ? 'var(--ink-blocked)' : 'var(--ink-accent)' }} />
      </div>
    </div>
  );
}

export default function SystemPage() {
  const [data, setData] = useState<Sys | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = () => api<Sys>('/zentra-ops/system').then((d) => { if (mounted) setData(d); }).catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  if (!data) return <p className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">System</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--ink-text-muted)' }}>Auto-refreshes every 5 seconds.</p>
      </div>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl p-5 space-y-3" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
          <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ink-text-muted)' }}>Host</div>
          <div className="text-sm space-y-1">
            <div>Hostname: <strong>{data.os.hostname}</strong></div>
            <div>OS: {data.os.platform} ({data.os.arch})</div>
            <div>Uptime: {dur(data.os.uptimeSec)}</div>
            <div>CPUs: {data.os.cpus} × {data.os.cpuModel}</div>
            <div>Load avg: {data.os.loadAvg.map(n => n.toFixed(2)).join(' / ')}</div>
          </div>
        </div>
        <div className="rounded-xl p-5 space-y-3" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
          <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ink-text-muted)' }}>Node process</div>
          <div className="text-sm space-y-1">
            <div>Version: {data.node.version}</div>
            <div>Process uptime: {dur(data.node.uptimeSec)}</div>
            <div>RSS: {bytes(data.node.memory.rss)}</div>
            <div>Heap: {bytes(data.node.memory.heapUsed)} / {bytes(data.node.memory.heapTotal)}</div>
          </div>
        </div>
      </section>

      <section className="rounded-xl p-5 space-y-4" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
        <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ink-text-muted)' }}>Resources</div>
        <Bar used={data.os.memUsed} total={data.os.memTotal} label="Memory" />
        {data.disk && <Bar used={data.disk.used} total={data.disk.total} label="Disk" />}
      </section>

      <section className="rounded-xl p-5 space-y-2" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
        <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ink-text-muted)' }}>Database</div>
        <div className="text-sm">Size: <strong>{bytes(data.db.bytes)}</strong></div>
        <div className="text-sm">Active connections: <strong>{data.db.connections}</strong></div>
      </section>
    </div>
  );
}
