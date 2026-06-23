'use client';

import { useEffect, useState } from 'react';

interface SharedSummary {
  huddle: {
    id: string;
    type: 'team' | 'personal';
    title: string;
    intention: string | null;
    summary: string | null;
    startedAt: string | null;
    endedAt: string | null;
    scheduledAt: string | null;
    hostName: string | null;
  };
  participants: Array<{
    name: string | null;
    role: 'host' | 'participant';
    attendanceStatus: string;
  }>;
  topics: Array<{
    id: string;
    title: string;
    context: string | null;
    status: 'open' | 'decided' | 'parked';
    decisions: Array<{ decisionText: string; ownerName: string | null }>;
  }>;
  intentions: Array<{
    text: string;
    softDueText: string | null;
    status: 'open' | 'done' | 'cancelled';
    ownerName: string | null;
  }>;
  followups: Array<{
    text: string;
    reviewDate: string | null;
    status: string;
    ownerName: string | null;
  }>;
  notes: Array<{
    text: string;
    createdAt: string;
    authorName: string | null;
  }>;
}

export function HuddleShareView({ token }: { token: string }) {
  const [summary, setSummary] = useState<SharedSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/huddles/share/${encodeURIComponent(token)}`, {
          credentials: 'omit',
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `Could not load summary (${res.status})`);
        }
        const data = await res.json();
        if (!cancelled) setSummary(data?.summary ?? null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Could not load summary');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  function fmtDate(s: string | null) {
    if (!s) return '';
    try { return new Date(s).toLocaleString(); } catch { return s; }
  }

  function fmtDateOnly(s: string | null) {
    if (!s) return '';
    try { return new Date(s).toLocaleDateString(); } catch { return s; }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--ink-bg)' }}>
        <div className="text-[13px]" style={{ color: 'var(--ink-text-muted)' }}>
          Loading huddle summary…
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: 'var(--ink-bg)' }}>
        <div className="max-w-md text-center">
          <h1 className="text-[18px] font-semibold mb-2" style={{ color: 'var(--ink-text)' }}>
            Summary unavailable
          </h1>
          <p className="text-[14px]" style={{ color: 'var(--ink-text-secondary)' }}>
            {error ?? 'This share link is invalid or has expired.'}
          </p>
        </div>
      </div>
    );
  }

  const { huddle, participants, topics, intentions, followups, notes } = summary;
  const decisions = topics.flatMap((t) => t.decisions.map((d) => ({ ...d, topicTitle: t.title })));

  return (
    <div className="min-h-screen" style={{ background: 'var(--ink-bg)' }}>
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-10">
        {/* Header */}
        <div className="mb-8">
          <div
            className="text-[11px] uppercase tracking-wider mb-2"
            style={{ color: 'var(--ink-text-muted)', letterSpacing: '0.08em' }}
          >
            Huddle summary · {huddle.type}
          </div>
          <h1 className="text-[28px] font-semibold leading-tight" style={{ color: 'var(--ink-text)' }}>
            {huddle.title}
          </h1>
          {huddle.intention && (
            <p className="mt-3 text-[15px] italic" style={{ color: 'var(--ink-text-secondary)' }}>
              “{huddle.intention}”
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]" style={{ color: 'var(--ink-text-muted)' }}>
            {huddle.hostName && <span>Hosted by {huddle.hostName}</span>}
            {huddle.endedAt && <span>Ended {fmtDate(huddle.endedAt)}</span>}
            {huddle.startedAt && <span>Started {fmtDate(huddle.startedAt)}</span>}
          </div>
        </div>

        {/* Participants */}
        {participants.length > 0 && (
          <Section title="Participants">
            <div className="flex flex-wrap gap-2">
              {participants.map((p, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 rounded-full text-[12.5px]"
                  style={{
                    background: 'var(--ink-surface)',
                    border: '1px solid var(--ink-border-subtle)',
                    color: 'var(--ink-text-secondary)',
                  }}
                >
                  {p.name ?? 'Unknown'}
                  {p.role === 'host' ? ' · host' : ''}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* Decisions */}
        {decisions.length > 0 && (
          <Section title="Decisions">
            <ul className="space-y-2">
              {decisions.map((d, i) => (
                <li
                  key={i}
                  className="rounded-lg p-3"
                  style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}
                >
                  <div className="text-[12px] mb-1" style={{ color: 'var(--ink-text-muted)' }}>
                    {d.topicTitle}
                  </div>
                  <div className="text-[14px]" style={{ color: 'var(--ink-text)' }}>
                    {d.decisionText}
                  </div>
                  {d.ownerName && (
                    <div className="text-[12px] mt-1" style={{ color: 'var(--ink-text-muted)' }}>
                      Owner: {d.ownerName}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Topics (any not decided) */}
        {topics.some((t) => t.status !== 'decided') && (
          <Section title="Topics discussed">
            <ul className="space-y-2">
              {topics.map((t) => (
                <li
                  key={t.id}
                  className="rounded-lg p-3"
                  style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px]" style={{ color: 'var(--ink-text)' }}>{t.title}</span>
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-full"
                      style={{
                        background: 'var(--ink-surface-raised)',
                        color: 'var(--ink-text-muted)',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {t.status}
                    </span>
                  </div>
                  {t.context && (
                    <p className="text-[13px] mt-1" style={{ color: 'var(--ink-text-secondary)' }}>
                      {t.context}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Intentions */}
        {intentions.length > 0 && (
          <Section title="Intentions / next actions">
            <ul className="space-y-2">
              {intentions.map((it, i) => (
                <li
                  key={i}
                  className="rounded-lg p-3"
                  style={{
                    background: 'var(--ink-surface)',
                    border: '1px solid var(--ink-border-subtle)',
                    opacity: it.status === 'cancelled' ? 0.6 : 1,
                  }}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5">{it.status === 'done' ? '✅' : '◯'}</span>
                    <div className="min-w-0">
                      <div
                        className="text-[14px]"
                        style={{
                          color: 'var(--ink-text)',
                          textDecoration: it.status === 'done' ? 'line-through' : 'none',
                        }}
                      >
                        {it.text}
                      </div>
                      <div className="text-[12px] mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>
                        {it.ownerName ? `Owner: ${it.ownerName}` : 'Unassigned'}
                        {it.softDueText ? ` · ${it.softDueText}` : ''}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Follow-ups */}
        {followups.length > 0 && (
          <Section title="Follow-ups">
            <ul className="space-y-2">
              {followups.map((f, i) => (
                <li
                  key={i}
                  className="rounded-lg p-3"
                  style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}
                >
                  <div className="text-[14px]" style={{ color: 'var(--ink-text)' }}>{f.text}</div>
                  <div className="text-[12px] mt-1" style={{ color: 'var(--ink-text-muted)' }}>
                    {f.ownerName ?? 'Unassigned'}
                    {f.reviewDate ? ` · review ${fmtDateOnly(f.reviewDate)}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Notes */}
        {notes.length > 0 && (
          <Section title="Notes">
            <div className="space-y-2">
              {notes.map((n, i) => (
                <div
                  key={i}
                  className="rounded-lg p-3"
                  style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}
                >
                  <div className="text-[13.5px] whitespace-pre-wrap" style={{ color: 'var(--ink-text)' }}>
                    {n.text}
                  </div>
                  <div className="text-[12px] mt-1.5" style={{ color: 'var(--ink-text-muted)' }}>
                    {n.authorName ?? 'Unknown'} · {fmtDate(n.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Closing summary */}
        {huddle.summary && (
          <Section title="Host's summary">
            <p className="text-[14px] whitespace-pre-wrap" style={{ color: 'var(--ink-text)' }}>
              {huddle.summary}
            </p>
          </Section>
        )}

        <div
          className="mt-12 pt-6 text-[12px] text-center"
          style={{ borderTop: '1px solid var(--ink-border-subtle)', color: 'var(--ink-text-muted)' }}
        >
          Read-only summary shared from Inkflow Huddles
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2
        className="text-[12px] uppercase tracking-wider mb-3"
        style={{ color: 'var(--ink-text-muted)', letterSpacing: '0.08em', fontWeight: 600 }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}
