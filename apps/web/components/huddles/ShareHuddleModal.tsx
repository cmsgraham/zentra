'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import type { HuddleDetail } from './types';

interface Share {
  id: string;
  huddleId: string;
  token: string;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
}

export function ShareHuddleModal({
  huddle,
  onClose,
}: {
  huddle: HuddleDetail;
  onClose: () => void;
}) {
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [expiresInDays, setExpiresInDays] = useState<number | ''>(30);
  const [emailing, setEmailing] = useState(false);
  const [emailResult, setEmailResult] = useState<
    { sentTo: string[]; skipped: string[] } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<{ shares: Share[] }>(`/huddles/${huddle.id}/shares`);
        if (!cancelled) setShares(r?.shares ?? []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Could not load share links');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [huddle.id]);

  function shareUrl(token: string) {
    if (typeof window === 'undefined') return `/huddles/share/${token}`;
    return `${window.location.origin}/huddles/share/${token}`;
  }

  async function createLink() {
    setError(null);
    setCreating(true);
    try {
      const body: any = {};
      if (typeof expiresInDays === 'number' && expiresInDays > 0) body.expiresInDays = expiresInDays;
      const r = await api<{ share: Share }>(`/huddles/${huddle.id}/share`, {
        method: 'POST',
        body,
      });
      setShares((prev) => [r.share, ...prev]);
    } catch (e: any) {
      setError(e?.message ?? 'Could not create share link');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(s: Share) {
    if (!confirm('Revoke this share link? Anyone with the link will lose access.')) return;
    try {
      await api(`/huddles/${huddle.id}/shares/${s.id}`, { method: 'DELETE' });
      setShares((prev) => prev.filter((x) => x.id !== s.id));
    } catch (e: any) {
      alert(e?.message ?? 'Could not revoke link');
    }
  }

  async function emailParticipants() {
    setError(null);
    setEmailResult(null);
    setEmailing(true);
    try {
      const r = await api<{ sentTo: string[]; skipped: string[] }>(
        `/huddles/${huddle.id}/email-summary`,
        { method: 'POST', body: { includeShareLink: true } },
      );
      setEmailResult({ sentTo: r.sentTo ?? [], skipped: r.skipped ?? [] });
    } catch (e: any) {
      setError(e?.message ?? 'Could not email participants');
    } finally {
      setEmailing(false);
    }
  }

  async function downloadMarkdown() {
    setError(null);
    try {
      const res = await fetch(`/api/huddles/${huddle.id}/export.md`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const md = await res.text();
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safe = (huddle.title || 'huddle').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 80);
      a.href = url;
      a.download = `${safe}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e: any) {
      setError(e?.message ?? 'Could not download minute');
    }
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    } catch {
      // fallback
      window.prompt('Copy this link:', text);
    }
  }

  function buildSummaryText() {
    const lines: string[] = [];
    lines.push(`# ${huddle.title}`);
    if (huddle.intention) lines.push(`Intention: ${huddle.intention}`);
    if (huddle.endedAt) lines.push(`Ended: ${new Date(huddle.endedAt).toLocaleString()}`);
    lines.push('');

    const decisions = huddle.topics.flatMap((t) =>
      (t.decisions ?? []).map((d) => ({ topic: t.title, ...d })),
    );
    if (decisions.length) {
      lines.push('## Decisions');
      decisions.forEach((d) => {
        lines.push(`- ${d.topic}: ${d.decisionText}${d.ownerName ? ` (owner: ${d.ownerName})` : ''}`);
      });
      lines.push('');
    }

    const intentions = huddle.intentions ?? [];
    if (intentions.length) {
      lines.push('## Intentions');
      intentions.forEach((i) => {
        const status = i.status === 'done' ? '[done] ' : '';
        lines.push(`- ${status}${i.text}${i.ownerName ? ` — ${i.ownerName}` : ''}${i.softDueText ? ` (${i.softDueText})` : ''}`);
      });
      lines.push('');
    }

    const followups = huddle.followups ?? [];
    if (followups.length) {
      lines.push('## Follow-ups');
      followups.forEach((f) => {
        lines.push(`- ${f.text}${f.ownerName ? ` — ${f.ownerName}` : ''}${f.reviewDate ? ` (review ${f.reviewDate})` : ''}`);
      });
      lines.push('');
    }

    const notes = huddle.notes ?? [];
    if (notes.length) {
      lines.push('## Notes');
      notes.forEach((n) => {
        lines.push(`- ${n.text}${n.authorName ? ` — ${n.authorName}` : ''}`);
      });
      lines.push('');
    }

    return lines.join('\n').trim();
  }

  async function nativeShare(s: Share) {
    const url = shareUrl(s.token);
    const nav = navigator as any;
    if (nav.share) {
      try {
        await nav.share({ title: huddle.title, text: `Huddle summary: ${huddle.title}`, url });
        return;
      } catch {
        // user cancelled — fall through
      }
    }
    copy(url, `share-${s.id}`);
  }

  function emailLink(s: Share) {
    const url = shareUrl(s.token);
    const subject = encodeURIComponent(`Huddle summary: ${huddle.title}`);
    const body = encodeURIComponent(`Hi,\n\nHere's the summary from our recent huddle "${huddle.title}":\n\n${url}\n\n— sent from Inkflow`);
    return `mailto:?subject=${subject}&body=${body}`;
  }

  const backdropMouseDown = useRef(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onMouseDown={(e) => {
        backdropMouseDown.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropMouseDown.current) {
          onClose();
        }
        backdropMouseDown.current = false;
      }}
    >
      <div
        className="w-full max-w-xl rounded-xl overflow-hidden flex flex-col"
        style={{ background: 'var(--ink-bg)', border: '1px solid var(--ink-border)', maxHeight: '90vh' }}
      >
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--ink-border-subtle)' }}
        >
          <div>
            <h2 className="text-[15px] font-semibold" style={{ color: 'var(--ink-text)' }}>
              Share huddle summary
            </h2>
            <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>
              Anyone with the link can view the read-only summary.
            </p>
          </div>
          <button onClick={onClose} className="text-[13px]" style={{ color: 'var(--ink-text-muted)' }}>
            Close
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto" style={{ flex: 1 }}>
          {error && (
            <div
              className="mb-3 px-3 py-2 rounded-md text-[13px]"
              style={{ background: 'var(--ink-surface)', color: 'var(--ink-blocked)' }}
            >
              {error}
            </div>
          )}

          <div
            className="rounded-lg p-3 mb-3"
            style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-[13px]" style={{ color: 'var(--ink-text)', fontWeight: 600 }}>
                  Email summary to participants
                </div>
                <div className="text-[12px] mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>
                  Sends decisions, intentions, follow-ups, notes & host summary to every
                  participant with an email address (skipping you, the host).
                </div>
              </div>
              <button
                onClick={emailParticipants}
                disabled={emailing}
                className="shrink-0 px-3.5 py-1.5 rounded-full text-[12.5px] whitespace-nowrap"
                style={{
                  background: 'var(--ink-accent)',
                  color: 'var(--ink-on-accent)',
                  fontWeight: 600,
                  opacity: emailing ? 0.7 : 1,
                }}
              >
                {emailing ? 'Sending…' : 'Email participants'}
              </button>
            </div>
            {emailResult && (
              <div
                className="mt-2.5 text-[12px] px-2.5 py-2 rounded-md"
                style={{
                  background: 'var(--ink-surface-raised)',
                  color: 'var(--ink-text-secondary)',
                  border: '1px solid var(--ink-border-subtle)',
                }}
              >
                {emailResult.sentTo.length > 0 ? (
                  <div>
                    Sent to <strong>{emailResult.sentTo.length}</strong>{' '}
                    participant{emailResult.sentTo.length === 1 ? '' : 's'}.
                  </div>
                ) : (
                  <div>No participants received the email.</div>
                )}
                {emailResult.skipped.length > 0 && (
                  <div className="mt-0.5" style={{ color: 'var(--ink-blocked)' }}>
                    Skipped {emailResult.skipped.length} (delivery failed or no email on file).
                  </div>
                )}
              </div>
            )}
          </div>

          <div
            className="rounded-lg p-3 mb-3"
            style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-[13px]" style={{ color: 'var(--ink-text)', fontWeight: 600 }}>
                  Download minute as Markdown
                </div>
                <div className="text-[12px] mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>
                  Save a self-contained file you can share with anyone — including people not in the app.
                </div>
              </div>
              <button
                onClick={downloadMarkdown}
                className="shrink-0 px-3.5 py-1.5 rounded-full text-[12.5px] whitespace-nowrap"
                style={{
                  background: 'var(--ink-surface-raised)',
                  color: 'var(--ink-text)',
                  border: '1px solid var(--ink-border)',
                  fontWeight: 600,
                }}
              >
                Download .md
              </button>
            </div>
          </div>

          <div
            className="rounded-lg p-3 mb-4"
            style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}
          >
            <div className="text-[12.5px] mb-2" style={{ color: 'var(--ink-text-muted)' }}>
              Create a new share link
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1.5 text-[12.5px]" style={{ color: 'var(--ink-text-secondary)' }}>
                Expires in
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={expiresInDays}
                  onChange={(e) => {
                    const v = e.target.value;
                    setExpiresInDays(v === '' ? '' : Math.max(1, Math.min(365, Number(v))));
                  }}
                  className="z-input"
                  style={{ width: 70 }}
                />
                days
              </label>
              <span className="text-[12px]" style={{ color: 'var(--ink-text-muted)' }}>
                (leave blank for no expiry)
              </span>
              <button
                onClick={createLink}
                disabled={creating}
                className="ml-auto px-3.5 py-1.5 rounded-full text-[12.5px]"
                style={{
                  background: 'var(--ink-accent)',
                  color: 'var(--ink-on-accent)',
                  fontWeight: 600,
                  opacity: creating ? 0.7 : 1,
                }}
              >
                {creating ? 'Creating…' : 'Create link'}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="text-[13px] py-6 text-center" style={{ color: 'var(--ink-text-muted)' }}>
              Loading…
            </div>
          ) : shares.length === 0 ? (
            <div className="text-[13px] py-6 text-center" style={{ color: 'var(--ink-text-muted)' }}>
              No active share links yet.
            </div>
          ) : (
            <div className="space-y-2">
              {shares.map((s) => {
                const url = shareUrl(s.token);
                const expired = s.expiresAt && new Date(s.expiresAt) < new Date();
                const revoked = !!s.revokedAt;
                const inactive = expired || revoked;
                return (
                  <div
                    key={s.id}
                    className="rounded-lg p-3"
                    style={{
                      background: 'var(--ink-surface)',
                      border: '1px solid var(--ink-border-subtle)',
                      opacity: inactive ? 0.6 : 1,
                    }}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        readOnly
                        value={url}
                        onFocus={(e) => e.currentTarget.select()}
                        className="z-input flex-1 min-w-0"
                        style={{ fontSize: '12.5px' }}
                      />
                      <button
                        onClick={() => copy(url, `url-${s.id}`)}
                        disabled={inactive}
                        className="px-3 py-1.5 rounded-full text-[12.5px]"
                        style={{
                          background: 'var(--ink-surface-raised)',
                          color: 'var(--ink-text)',
                          border: '1px solid var(--ink-border-subtle)',
                          fontWeight: 550,
                        }}
                      >
                        {copied === `url-${s.id}` ? 'Copied!' : 'Copy link'}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <button
                        onClick={() => copy(buildSummaryText(), `text-${s.id}`)}
                        className="text-[12px] px-2.5 py-1 rounded-full"
                        style={{
                          background: 'transparent',
                          color: 'var(--ink-text-secondary)',
                          border: '1px solid var(--ink-border-subtle)',
                        }}
                      >
                        {copied === `text-${s.id}` ? 'Copied summary!' : 'Copy summary text'}
                      </button>
                      <a
                        href={emailLink(s)}
                        className="text-[12px] px-2.5 py-1 rounded-full"
                        style={{
                          background: 'transparent',
                          color: 'var(--ink-text-secondary)',
                          border: '1px solid var(--ink-border-subtle)',
                          textDecoration: 'none',
                        }}
                      >
                        Email…
                      </a>
                      <button
                        onClick={() => nativeShare(s)}
                        className="text-[12px] px-2.5 py-1 rounded-full"
                        style={{
                          background: 'transparent',
                          color: 'var(--ink-text-secondary)',
                          border: '1px solid var(--ink-border-subtle)',
                        }}
                      >
                        Share…
                      </button>
                      <span className="ml-auto text-[11.5px]" style={{ color: 'var(--ink-text-muted)' }}>
                        {revoked
                          ? 'Revoked'
                          : expired
                          ? 'Expired'
                          : s.expiresAt
                          ? `Expires ${new Date(s.expiresAt).toLocaleDateString()}`
                          : 'No expiry'}
                        {' · '}
                        {s.viewCount} view{s.viewCount === 1 ? '' : 's'}
                      </span>
                      {!inactive && (
                        <button
                          onClick={() => revoke(s)}
                          className="text-[12px] px-2.5 py-1 rounded-full"
                          style={{
                            background: 'transparent',
                            color: 'var(--ink-blocked)',
                            border: '1px solid var(--ink-border-subtle)',
                          }}
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
