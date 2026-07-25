'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';

interface ReportTopic {
  id: string;
  title: string;
  status: string;
  openReason: string | null;
  horizon: string;
  deferCount: number;
  ageDays: number;
  ownerName: string | null;
  approverName: string | null;
  huddleId: string;
  huddleTitle: string;
}

interface ReportHuddle {
  id: string; title: string; status: string;
  endedAt: string | null; scheduledAt: string | null; createdAt: string;
  opened: number; closed: number; cancelled: number;
}

interface ReportActionItem {
  text: string; ownerName: string | null; huddleTitle: string;
  converted: boolean; taskStatus: string | null;
  dueDate: string | null; softDueText: string | null;
  done: boolean; overdue: boolean;
}

interface Report {
  template: { id: string; name: string; type: string };
  huddles: ReportHuddle[];
  openTopics: ReportTopic[];
  escalations: ReportTopic[];
  longTerm: ReportTopic[];
  decisions: Array<{
    decisionText: string; topicTitle: string; huddleTitle: string;
    ownerName: string | null; createdAt: string;
  }>;
  actionItems: ReportActionItem[];
  stats: {
    huddleCount: number; opened: number; closed: number; cancelled: number;
    stillOpen: number; needsDecisionNoApprover: number;
    medianDaysToClose: number | null;
    actionsTotal: number; actionsConverted: number;
    actionsDone: number; actionsOverdue: number;
  };
}

function fmtDate(s: string | null) {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric' }); }
  catch { return '—'; }
}

export function HuddleSeriesReportView({ templateId }: { templateId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<Report>(`/huddles/templates/${templateId}/report`);
        if (!cancelled) setReport(r);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? 'Could not load report');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [templateId]);

  if (loading) {
    return <div className="p-8 text-[13px]" style={{ color: 'var(--ink-text-muted)' }}>Loading report…</div>;
  }
  if (err || !report) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <div className="text-[14px]" style={{ color: 'var(--ink-blocked)' }}>{err ?? 'Report not found'}</div>
        <Link href="/huddles/templates" className="mt-4 inline-block z-caption" style={{ color: 'var(--ink-accent)' }}>
          ← Back to templates
        </Link>
      </div>
    );
  }

  const s = report.stats;

  return (
    <div className="max-w-5xl mx-auto px-5 sm:px-8 py-8 w-full">
      <Link href="/huddles/templates" className="z-caption inline-flex items-center gap-1.5 mb-4"
        style={{ color: 'var(--ink-text-muted)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Templates
      </Link>

      <h1 className="z-page-title">{report.template.name}</h1>
      <p className="z-body mt-1.5" style={{ color: 'var(--ink-text-secondary)' }}>
        How this recurring meeting is actually doing, across {s.huddleCount}{' '}
        {s.huddleCount === 1 ? 'huddle' : 'huddles'}.
      </p>

      {s.huddleCount === 0 && (
        <div className="mt-6 p-5 rounded-2xl text-[13px]"
          style={{ background: 'var(--ink-surface)', border: '1px dashed var(--ink-border-subtle)', color: 'var(--ink-text-muted)' }}>
          No huddles have been started from this template yet. Only huddles created from
          the template are tracked here, so this fills in as you run the meeting.
        </div>
      )}

      {s.huddleCount > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            <Stat label="Still open" value={String(s.stillOpen)} />
            <Stat label="Closed" value={String(s.closed)} />
            <Stat
              label="Median to close"
              value={s.medianDaysToClose == null ? '—' : `${s.medianDaysToClose}d`}
            />
            <Stat
              label="Actions overdue"
              value={String(s.actionsOverdue)}
              tone={s.actionsOverdue > 0 ? 'bad' : 'normal'}
            />
          </div>

          {/* Aging leads: what is at risk now, rather than what already finished. */}
          <Section
            title="Still in the loop"
            hint="Oldest first — age counts from when the topic was first raised, not last copied"
          >
            {report.openTopics.length === 0 ? (
              <Empty text="Nothing outstanding. The loop is clear." />
            ) : (
              <ul className="space-y-2">
                {report.openTopics.map((t) => (
                  <li key={t.id} className="rounded-lg p-3"
                    style={{ background: 'var(--ink-bg)', border: '1px solid var(--ink-border-subtle)' }}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <Link href={`/huddles/${t.huddleId}`} className="text-[14px]" style={{ color: 'var(--ink-text)' }}>
                          {t.title}
                        </Link>
                        <div className="flex items-center gap-2 mt-1 flex-wrap text-[11.5px]"
                          style={{ color: 'var(--ink-text-muted)' }}>
                          {t.openReason === 'needs_decision' && (
                            <Chip text={t.approverName ? `Needs decision · ${t.approverName}` : 'Needs decision · no decision-maker'} tone="bad" />
                          )}
                          {t.deferCount > 0 && <Chip text={`Deferred ×${t.deferCount}`} />}
                          {t.ownerName && <span>{t.ownerName}</span>}
                          <span>· last seen in {t.huddleTitle}</span>
                        </div>
                      </div>
                      <span className="text-[12px] shrink-0" style={{ color: 'var(--ink-text-muted)' }}>
                        {t.ageDays}d old
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {report.escalations.length > 0 && (
            <Section
              title="Needs an exit"
              hint="Round the loop three or more times with nothing in flight underneath"
            >
              <ul className="space-y-2">
                {report.escalations.map((t) => (
                  <li key={t.id} className="rounded-lg p-3"
                    style={{ background: 'var(--ink-accent-subtle)', border: '1px dashed var(--ink-blocked)' }}>
                    <Link href={`/huddles/${t.huddleId}`} className="text-[14px]" style={{ color: 'var(--ink-text)' }}>
                      {t.title}
                    </Link>
                    <div className="text-[11.5px] mt-1" style={{ color: 'var(--ink-text-muted)' }}>
                      Deferred {t.deferCount}× · {t.ageDays}d old
                      {t.approverName ? ` · ${t.approverName} decides` : ' · no decision-maker assigned'}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {report.longTerm.length > 0 && (
            <Section title="Long-term" hint="Moved out of the weekly rotation — review on a slower cadence">
              <ul className="space-y-2">
                {report.longTerm.map((t) => (
                  <li key={t.id} className="rounded-lg p-3 text-[13.5px]"
                    style={{ background: 'var(--ink-bg)', border: '1px solid var(--ink-border-subtle)', color: 'var(--ink-text)' }}>
                    <Link href={`/huddles/${t.huddleId}`}>{t.title}</Link>
                    <span className="text-[11.5px] ml-2" style={{ color: 'var(--ink-text-muted)' }}>
                      {t.ageDays}d old{t.ownerName ? ` · ${t.ownerName}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section
            title="Action items"
            hint={`${s.actionsConverted} of ${s.actionsTotal} became tracked tasks · ${s.actionsDone} done`}
          >
            {report.actionItems.length === 0 ? (
              <Empty text="No action items yet." />
            ) : (
              <ul className="space-y-1.5">
                {report.actionItems.map((a, i) => (
                  <li key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-lg text-[13.5px]"
                    style={{
                      background: 'var(--ink-bg)', border: '1px solid var(--ink-border-subtle)',
                      opacity: a.done ? 0.6 : 1,
                    }}>
                    <span className="flex-1" style={{ color: 'var(--ink-text)', textDecoration: a.done ? 'line-through' : 'none' }}>
                      {a.text}
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {a.overdue && <Chip text="Overdue" tone="bad" />}
                      {!a.converted && <Chip text="Not tracked" />}
                      <span className="text-[11.5px]" style={{ color: 'var(--ink-text-muted)' }}>
                        {a.ownerName ?? '—'}{a.dueDate ? ` · ${fmtDate(a.dueDate)}` : a.softDueText ? ` · ${a.softDueText}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Decisions" hint="Everything this series has settled, oldest first">
            {report.decisions.length === 0 ? (
              <Empty text="No decisions recorded yet." />
            ) : (
              <ul className="space-y-2">
                {report.decisions.map((d, i) => (
                  <li key={i} className="rounded-lg p-3"
                    style={{ background: 'var(--ink-bg)', border: '1px solid var(--ink-border-subtle)', borderLeft: '2px solid var(--ink-done)' }}>
                    <p className="text-[13.5px]" style={{ color: 'var(--ink-text)' }}>{d.decisionText}</p>
                    <div className="text-[11.5px] mt-1" style={{ color: 'var(--ink-text-muted)' }}>
                      {d.topicTitle} · {d.huddleTitle}{d.ownerName ? ` · ${d.ownerName}` : ''} · {fmtDate(d.createdAt)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Per-huddle throughput" hint="Opening faster than closing is the loop silting up">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]" style={{ color: 'var(--ink-text)' }}>
                <thead>
                  <tr style={{ color: 'var(--ink-text-muted)' }}>
                    <th className="text-left font-medium py-1.5">Huddle</th>
                    <th className="text-right font-medium py-1.5">Topics</th>
                    <th className="text-right font-medium py-1.5">Closed</th>
                    <th className="text-right font-medium py-1.5">Cancelled</th>
                    <th className="text-right font-medium py-1.5">When</th>
                  </tr>
                </thead>
                <tbody>
                  {report.huddles.map((h) => (
                    <tr key={h.id} style={{ borderTop: '1px solid var(--ink-border-subtle)' }}>
                      <td className="py-1.5">
                        <Link href={`/huddles/${h.id}`} style={{ color: 'var(--ink-accent)' }}>{h.title}</Link>
                      </td>
                      <td className="text-right py-1.5">{h.opened}</td>
                      <td className="text-right py-1.5">{h.closed}</td>
                      <td className="text-right py-1.5">{h.cancelled}</td>
                      <td className="text-right py-1.5" style={{ color: 'var(--ink-text-muted)' }}>
                        {fmtDate(h.endedAt ?? h.scheduledAt ?? h.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'bad' }) {
  return (
    <div className="rounded-xl p-3.5"
      style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}>
      <div className="text-[22px] font-semibold"
        style={{ color: tone === 'bad' ? 'var(--ink-blocked)' : 'var(--ink-text)' }}>
        {value}
      </div>
      <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>{label}</div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <div className="flex items-baseline justify-between gap-3 mb-2.5 flex-wrap">
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--ink-text)' }}>{title}</h2>
        {hint && <span className="text-[11.5px]" style={{ color: 'var(--ink-text-muted)' }}>{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Chip({ text, tone = 'normal' }: { text: string; tone?: 'normal' | 'bad' }) {
  return (
    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
      style={{
        background: tone === 'bad' ? 'var(--ink-accent-subtle)' : 'var(--ink-surface-raised)',
        color: tone === 'bad' ? 'var(--ink-blocked)' : 'var(--ink-text-secondary)',
        fontWeight: 600, letterSpacing: '0.05em',
      }}>
      {text}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-[12.5px] py-5 text-center" style={{ color: 'var(--ink-text-faint)' }}>{text}</div>;
}
