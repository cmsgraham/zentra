'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import type {
  HuddleDetail, HuddleSignal, HuddleTopic, HuddleDecision, HuddleIntention, HuddleFollowup,
} from './types';
import { HuddleTypeBadge, StatusDot } from './HuddlesListView';
import { Avatar } from './StartHuddleView';
import { ShareHuddleModal } from './ShareHuddleModal';

const POLL_MS = 6000; // near-realtime via polling

interface Workspace { id: string; name: string }

export function HuddleDetailView({ huddleId }: { huddleId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [huddle, setHuddle] = useState<HuddleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const lastFetchRef = useRef(0);

  const fetchHuddle = useCallback(async (silent = false) => {
    try {
      const res = await api<{ huddle: HuddleDetail }>(`/huddles/${huddleId}`);
      setHuddle(res.huddle);
      setErr(null);
    } catch (e: any) {
      if (!silent) setErr(e?.message ?? 'Could not load huddle');
    } finally {
      lastFetchRef.current = Date.now();
      setLoading(false);
    }
  }, [huddleId]);

  useEffect(() => { fetchHuddle(); }, [fetchHuddle]);

  // Polling for near-realtime
  useEffect(() => {
    const t = setInterval(() => fetchHuddle(true), POLL_MS);
    const onFocus = () => fetchHuddle(true);
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [fetchHuddle]);

  useEffect(() => {
    (async () => {
      try {
        const data = await api<{ items: Workspace[] }>('/workspaces');
        setWorkspaces(data?.items ?? []);
      } catch {}
    })();
  }, []);

  const isHost = !!huddle && !!user && huddle.hostUserId === user.id;
  const myParticipant = huddle?.participants.find((p) => p.userId === user?.id);

  const refresh = () => fetchHuddle(true);

  if (loading) {
    return <div className="p-8 text-[13px]" style={{ color: 'var(--ink-text-muted)' }}>Loading huddle…</div>;
  }
  if (err || !huddle) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <div className="text-[14px]" style={{ color: 'var(--ink-blocked)' }}>{err ?? 'Huddle not found'}</div>
        <button onClick={() => router.push('/huddles')} className="mt-4 z-caption" style={{ color: 'var(--ink-accent)' }}>← Back to huddles</button>
      </div>
    );
  }

  return (
    <div className="w-full">
      <HuddleHeader
        huddle={huddle}
        isHost={isHost}
        canCheckIn={!!myParticipant && myParticipant.attendanceStatus !== 'present'}
        onChange={refresh}
      />
      <IntentionBar huddle={huddle} isHost={isHost} onChange={refresh} />
      <div className="px-4 sm:px-6 lg:px-8 pb-24">
        {huddle.type === 'team' ? (
          <TeamBoard huddle={huddle} workspaces={workspaces} onChange={refresh} />
        ) : (
          <PersonalBoard huddle={huddle} workspaces={workspaces} onChange={refresh} />
        )}
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────

function HuddleHeader({
  huddle, isHost, canCheckIn, onChange,
}: { huddle: HuddleDetail; isHost: boolean; canCheckIn: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  async function start() {
    setBusy(true);
    try { await api(`/huddles/${huddle.id}`, { method: 'PUT', body: { status: 'active' } }); onChange(); }
    finally { setBusy(false); }
  }
  async function saveAsTemplate() {
    const name = prompt('Name this template (e.g. "Weekly engineering sync"):', huddle.title);
    if (!name || !name.trim()) return;
    setBusy(true);
    try {
      await api(`/huddles/${huddle.id}/save-as-template`, {
        method: 'POST',
        body: { name: name.trim(), includeTopics: true, includeParticipants: true },
      });
      alert('Template saved. Use it next time from "Start a Huddle".');
    } catch (e: any) {
      alert(e?.message ?? 'Could not save template');
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    if (!confirm('Close this huddle? It will be archived.')) return;
    setBusy(true);
    try { await api(`/huddles/${huddle.id}/close`, { method: 'POST', body: {} }); onChange(); }
    finally { setBusy(false); }
  }
  async function checkIn() {
    setBusy(true);
    try { await api(`/huddles/${huddle.id}/check-in`, { method: 'POST', body: {} }); onChange(); }
    finally { setBusy(false); }
  }

  const presentCount = huddle.participants.filter((p) => p.attendanceStatus === 'present').length;

  return (
    <>
    <div
      className="px-4 sm:px-6 lg:px-8 pt-6 pb-4"
      style={{ borderBottom: '1px solid var(--ink-border-subtle)', background: 'var(--ink-bg)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <Link href="/huddles" className="z-caption inline-flex items-center gap-1.5" style={{ color: 'var(--ink-text-muted)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Huddles
        </Link>
        <div className="flex items-center gap-2">
          {canCheckIn && huddle.status !== 'closed' && (
            <button
              onClick={checkIn}
              disabled={busy}
              className="px-3 py-1.5 rounded-full text-[12.5px]"
              style={{ background: 'var(--ink-surface-raised)', color: 'var(--ink-text)', fontWeight: 550, border: '1px solid var(--ink-border-subtle)' }}
            >
              I’m here
            </button>
          )}
          {isHost && huddle.status === 'draft' && (
            <button onClick={start} disabled={busy}
              className="px-3.5 py-1.5 rounded-full text-[12.5px]"
              style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)', fontWeight: 600 }}>
              Start
            </button>
          )}
          {isHost && huddle.status === 'active' && (
            <button onClick={close} disabled={busy}
              className="px-3.5 py-1.5 rounded-full text-[12.5px]"
              style={{ background: 'var(--ink-surface-raised)', color: 'var(--ink-text)', fontWeight: 550, border: '1px solid var(--ink-border)' }}>
              Close huddle
            </button>
          )}
          {isHost && huddle.status === 'closed' && (
            <button
              onClick={() => setShareOpen(true)}
              disabled={busy}
              title="Share a read-only summary of this huddle"
              className="px-3.5 py-1.5 rounded-full text-[12.5px]"
              style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)', fontWeight: 600 }}
            >
              Share summary
            </button>
          )}          {isHost && (
            <button
              onClick={saveAsTemplate}
              disabled={busy}
              title="Save this huddle's title, intention, participants, and topics as a reusable template"
              className="px-3 py-1.5 rounded-full text-[12.5px]"
              style={{ background: 'transparent', color: 'var(--ink-text-secondary)', border: '1px dashed var(--ink-border)' }}
            >
              Save as template
            </button>
          )}
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <HuddleTypeBadge type={huddle.type} />
            <StatusDot status={huddle.status} />
          </div>
          <h1 className="z-page-title">{huddle.title}</h1>
          <p className="z-caption mt-1.5" style={{ color: 'var(--ink-text-muted)' }}>
            Hosted by {huddle.hostName ?? 'someone'}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <ParticipantStack participants={huddle.participants} />
          <span className="text-[12px]" style={{ color: 'var(--ink-text-muted)' }}>
            {presentCount}/{huddle.participants.length} present
          </span>
        </div>
      </div>
    </div>
    {shareOpen && (
      <ShareHuddleModal huddle={huddle} onClose={() => setShareOpen(false)} />
    )}
    </>
  );
}

function ParticipantStack({ participants }: { participants: HuddleDetail['participants'] }) {
  const visible = participants.slice(0, 5);
  const rest = participants.length - visible.length;
  return (
    <div className="flex items-center">
      {visible.map((p, i) => (
        <span key={p.id} style={{ marginLeft: i === 0 ? 0 : -8, opacity: p.attendanceStatus === 'present' ? 1 : 0.55, position: 'relative', zIndex: visible.length - i }}>
          <Avatar name={p.userName ?? p.externalName ?? '?'} url={p.userAvatarUrl} size={28} />
        </span>
      ))}
      {rest > 0 && (
        <span
          className="inline-flex items-center justify-center text-[10px]"
          style={{
            width: 28, height: 28, borderRadius: '50%', marginLeft: -8,
            background: 'var(--ink-surface-raised)', color: 'var(--ink-text-muted)',
            border: '2px solid var(--ink-bg)', fontWeight: 600,
          }}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}

// ── Sticky intention bar ─────────────────────────────────────────────────

function IntentionBar({ huddle, isHost, onChange }: { huddle: HuddleDetail; isHost: boolean; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(huddle.intention ?? '');

  async function save() {
    await api(`/huddles/${huddle.id}`, { method: 'PUT', body: { intention: val.trim() || null } });
    setEditing(false);
    onChange();
  }

  return (
    <div
      className="sticky top-0 z-10 px-4 sm:px-6 lg:px-8 py-3"
      style={{
        background: 'var(--ink-accent-subtle)',
        borderBottom: '1px solid var(--ink-border-subtle)',
        backdropFilter: 'saturate(140%) blur(6px)',
      }}
    >
      <div className="max-w-5xl">
        <div className="text-[10.5px] uppercase tracking-wider mb-1" style={{ color: 'var(--ink-accent)', fontWeight: 700, letterSpacing: '0.08em' }}>
          Intention
        </div>
        {editing ? (
          <div className="flex items-start gap-2">
            <textarea
              value={val}
              onChange={(e) => setVal(e.target.value)}
              rows={2}
              autoFocus
              className="flex-1 px-2.5 py-1.5 rounded-md text-[14px] resize-none"
              style={{ background: 'var(--ink-surface)', color: 'var(--ink-text)', border: '1px solid var(--ink-border)', outline: 'none' }}
              placeholder="What matters most from this huddle?"
            />
            <button onClick={save} className="px-3 py-1.5 rounded-md text-[12.5px]"
              style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)', fontWeight: 600 }}>
              Save
            </button>
            <button onClick={() => { setEditing(false); setVal(huddle.intention ?? ''); }} className="px-2 py-1.5 text-[12.5px]"
              style={{ color: 'var(--ink-text-muted)' }}>
              Cancel
            </button>
          </div>
        ) : (
          <div
            className={`text-[14.5px] ${isHost ? 'cursor-text' : ''}`}
            style={{ color: huddle.intention ? 'var(--ink-text)' : 'var(--ink-text-muted)', fontStyle: huddle.intention ? 'normal' : 'italic', lineHeight: 1.5 }}
            onClick={() => isHost && setEditing(true)}
          >
            {huddle.intention || (isHost ? 'What matters most from this huddle? Click to set.' : 'Intention not set yet.')}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Team Board (4 columns) ────────────────────────────────────────────────

function TeamBoard({ huddle, workspaces, onChange }: { huddle: HuddleDetail; workspaces: Workspace[]; onChange: () => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-5">
      <Column
        label="Signals"
        hint="Quick updates"
        accent="var(--ink-text-muted)"
        addPlaceholder="What changed?"
        onAdd={async (text, why) => {
          await api(`/huddles/${huddle.id}/signals`, { method: 'POST', body: { text, whyItMatters: why || null } });
          onChange();
        }}
        secondaryPlaceholder="Why it matters (optional)"
      >
        {huddle.signals.length === 0 ? <Empty text="No signals yet" /> :
          huddle.signals.map((s) => <SignalCard key={s.id} signal={s} huddleId={huddle.id} onChange={onChange} />)}
      </Column>

      <Column
        label="Focus topics"
        hint="What we discuss"
        accent="var(--ink-accent)"
        addPlaceholder="A topic to discuss"
        onAdd={async (text, ctx) => {
          await api(`/huddles/${huddle.id}/topics`, { method: 'POST', body: { title: text, context: ctx || null } });
          onChange();
        }}
        secondaryPlaceholder="Context (optional)"
      >
        {huddle.topics.length === 0 ? <Empty text="No topics yet" /> :
          huddle.topics.map((t) => <TopicCard key={t.id} topic={t} participants={huddle.participants} huddleId={huddle.id} onChange={onChange} />)}
      </Column>

      <Column
        label="Decisions"
        hint="Outcomes"
        accent="var(--ink-done)"
        readonly
      >
        {huddle.topics.flatMap((t) => (t.decisions ?? []).map((d) => ({ d, t }))).length === 0 ? (
          <Empty text="No decisions yet" />
        ) : (
          huddle.topics.flatMap((t) =>
            (t.decisions ?? []).map((d) => (
              <DecisionCard key={d.id} decision={d} topic={t} huddleId={huddle.id} onChange={onChange} />
            )),
          )
        )}
      </Column>

      <Column
        label="Next intentions"
        hint="What moves now"
        accent="var(--ink-in-progress)"
        addPlaceholder="A concrete next step"
        onAdd={async (text, due) => {
          await api(`/huddles/${huddle.id}/intentions`, { method: 'POST', body: { text, softDueText: due || null } });
          onChange();
        }}
        secondaryPlaceholder="When? (e.g. by Friday)"
      >
        {huddle.intentions.length === 0 ? <Empty text="No intentions yet" /> :
          huddle.intentions.map((i) => (
            <IntentionCard key={i.id} intention={i} huddleId={huddle.id} workspaces={workspaces} huddleWorkspaceId={huddle.workspaceId} onChange={onChange} />
          ))}

        {huddle.followups.length > 0 && (
          <div className="mt-3 pt-3" style={{ borderTop: '1px dashed var(--ink-border-subtle)' }}>
            <div className="text-[10.5px] uppercase tracking-wider mb-2" style={{ color: 'var(--ink-text-muted)', fontWeight: 600 }}>
              Follow-ups
            </div>
            {huddle.followups.map((f) => <FollowupCard key={f.id} followup={f} huddleId={huddle.id} onChange={onChange} />)}
          </div>
        )}
      </Column>
    </div>
  );
}

// ── Personal Board (warmer, single-column-ish, sections) ──────────────────

function PersonalBoard({ huddle, workspaces, onChange }: { huddle: HuddleDetail; workspaces: Workspace[]; onChange: () => void }) {
  // For personal huddles we use signals to capture wins/friction/growth/support,
  // tagged via the "whyItMatters" prefix. Simpler than separate tables and
  // keeps the schema unified. We render them grouped by tag.

  const [tab, setTab] = useState<'wins' | 'friction' | 'growth' | 'support'>('wins');
  const labels = {
    wins: { title: 'Wins', prompt: 'What went well?', placeholder: 'A small or big win' },
    friction: { title: 'Friction', prompt: 'What is slowing progress?', placeholder: 'Where it’s sticky' },
    growth: { title: 'Growth', prompt: 'What support or learning matters?', placeholder: 'A skill, a stretch, a curiosity' },
    support: { title: 'Support', prompt: 'What is needed from the other person?', placeholder: 'An ask, an unblock, a connection' },
  } as const;

  const tagged = (kind: typeof tab) => huddle.signals.filter((s) => (s.whyItMatters ?? '').startsWith(`@${kind}`));
  const cleanText = (s: HuddleSignal) => s.text;

  async function add(text: string) {
    await api(`/huddles/${huddle.id}/signals`, { method: 'POST', body: { text, whyItMatters: `@${tab}` } });
    onChange();
  }

  return (
    <div className="max-w-3xl mx-auto mt-6 space-y-6">
      <div className="flex gap-1 p-1 rounded-xl"
        style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}>
        {(['wins', 'friction', 'growth', 'support'] as const).map((k) => {
          const on = tab === k;
          const count = tagged(k).length;
          return (
            <button
              key={k}
              onClick={() => setTab(k)}
              className="flex-1 px-3 py-2 rounded-lg text-[13px] transition-all"
              style={{
                background: on ? 'var(--ink-surface-raised)' : 'transparent',
                color: on ? 'var(--ink-text)' : 'var(--ink-text-muted)',
                fontWeight: on ? 600 : 450,
                boxShadow: on ? 'var(--ink-shadow-sm)' : 'none',
              }}
            >
              {labels[k].title}
              {count > 0 && <span style={{ opacity: 0.55, marginLeft: 6 }}>{count}</span>}
            </button>
          );
        })}
      </div>

      <PersonalSection
        title={labels[tab].title}
        prompt={labels[tab].prompt}
        placeholder={labels[tab].placeholder}
        items={tagged(tab).map(cleanText)}
        rawItems={tagged(tab)}
        onAdd={add}
        onDelete={async (id) => { await api(`/huddles/${huddle.id}/signals/${id}`, { method: 'DELETE' }); onChange(); }}
      />

      <div className="rounded-2xl p-5" style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}>
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-[15px] font-semibold" style={{ color: 'var(--ink-text)' }}>Next intentions</h3>
          <span className="text-[11.5px]" style={{ color: 'var(--ink-text-muted)' }}>1–3 concrete next steps</span>
        </div>
        <QuickAdd
          placeholder="A concrete next step"
          secondaryPlaceholder="When? (e.g. this week)"
          onAdd={async (text, due) => {
            await api(`/huddles/${huddle.id}/intentions`, { method: 'POST', body: { text, softDueText: due || null } });
            onChange();
          }}
        />
        <div className="mt-3 space-y-2">
          {huddle.intentions.length === 0 ? <Empty text="None yet" /> :
            huddle.intentions.map((i) => (
              <IntentionCard key={i.id} intention={i} huddleId={huddle.id} workspaces={workspaces} huddleWorkspaceId={huddle.workspaceId} onChange={onChange} />
            ))}
        </div>

        {huddle.followups.length > 0 && (
          <div className="mt-5 pt-4" style={{ borderTop: '1px dashed var(--ink-border-subtle)' }}>
            <div className="text-[10.5px] uppercase tracking-wider mb-2" style={{ color: 'var(--ink-text-muted)', fontWeight: 600 }}>
              Carried from last time
            </div>
            {huddle.followups.map((f) => <FollowupCard key={f.id} followup={f} huddleId={huddle.id} onChange={onChange} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function PersonalSection({
  title, prompt, placeholder, items, rawItems, onAdd, onDelete,
}: {
  title: string; prompt: string; placeholder: string; items: string[];
  rawItems: HuddleSignal[];
  onAdd: (text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <div className="rounded-2xl p-5" style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}>
      <div className="mb-3">
        <h3 className="text-[15px] font-semibold" style={{ color: 'var(--ink-text)' }}>{title}</h3>
        <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>{prompt}</p>
      </div>
      <QuickAdd placeholder={placeholder} onAdd={async (t) => onAdd(t)} />
      <div className="mt-3 space-y-2">
        {rawItems.length === 0 ? (
          <Empty text="Nothing here yet" />
        ) : (
          rawItems.map((s, i) => (
            <div
              key={s.id}
              className="group flex items-start gap-2.5 px-3 py-2 rounded-lg"
              style={{ background: 'var(--ink-bg)', border: '1px solid var(--ink-border-subtle)' }}
            >
              <span style={{
                width: 6, height: 6, borderRadius: '50%', marginTop: 8,
                background: 'var(--ink-accent)', flexShrink: 0,
              }} />
              <p className="flex-1 text-[14px]" style={{ color: 'var(--ink-text)', lineHeight: 1.5 }}>{items[i]}</p>
              <button
                onClick={() => onDelete(s.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-[11.5px]"
                style={{ color: 'var(--ink-text-muted)' }}
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Generic Column (team board) ───────────────────────────────────────────

function Column({
  label, hint, accent, children, onAdd, addPlaceholder, secondaryPlaceholder, readonly,
}: {
  label: string;
  hint?: string;
  accent: string;
  children: React.ReactNode;
  onAdd?: (primary: string, secondary?: string) => Promise<void> | void;
  addPlaceholder?: string;
  secondaryPlaceholder?: string;
  readonly?: boolean;
}) {
  return (
    <section
      className="rounded-2xl p-4 flex flex-col"
      style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)', minHeight: 320 }}
    >
      <header className="flex items-baseline justify-between mb-3">
        <div className="flex items-baseline gap-2">
          <span style={{
            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
            background: accent, transform: 'translateY(-2px)',
          }} />
          <h3 className="text-[14px] font-semibold" style={{ color: 'var(--ink-text)' }}>{label}</h3>
        </div>
        {hint && <span className="text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>{hint}</span>}
      </header>
      {!readonly && onAdd && (
        <QuickAdd placeholder={addPlaceholder ?? 'Add'} secondaryPlaceholder={secondaryPlaceholder} onAdd={onAdd} />
      )}
      <div className="mt-3 space-y-2 flex-1">
        {children}
      </div>
    </section>
  );
}

// ── Quick add (one or two fields) ─────────────────────────────────────────

function QuickAdd({
  placeholder, secondaryPlaceholder, onAdd,
}: {
  placeholder: string;
  secondaryPlaceholder?: string;
  onAdd: (primary: string, secondary?: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!a.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(a.trim(), b.trim() || undefined);
      setA(''); setB(''); setOpen(false);
    } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left px-3 py-2 rounded-lg text-[13px] transition-all"
        style={{
          background: 'var(--ink-bg)', color: 'var(--ink-text-muted)',
          border: '1px dashed var(--ink-border)',
        }}
      >
        + {placeholder}
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="rounded-lg p-2" style={{ background: 'var(--ink-bg)', border: '1px solid var(--ink-accent)' }}>
      <input
        autoFocus value={a} onChange={(e) => setA(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2 py-1.5 text-[13.5px] bg-transparent outline-none"
        style={{ color: 'var(--ink-text)' }}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
      />
      {secondaryPlaceholder && (
        <input
          value={b} onChange={(e) => setB(e.target.value)}
          placeholder={secondaryPlaceholder}
          className="w-full px-2 py-1 text-[12px] bg-transparent outline-none"
          style={{ color: 'var(--ink-text-secondary)' }}
        />
      )}
      <div className="flex items-center gap-2 mt-1.5">
        <button type="submit" disabled={!a.trim() || busy}
          className="px-2.5 py-1 rounded-md text-[12px]"
          style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)', fontWeight: 600, opacity: !a.trim() ? 0.5 : 1 }}>
          Add
        </button>
        <button type="button" onClick={() => { setOpen(false); setA(''); setB(''); }}
          className="text-[11.5px]" style={{ color: 'var(--ink-text-muted)' }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-center text-[12.5px] py-6" style={{ color: 'var(--ink-text-faint)' }}>{text}</div>;
}

function DetailsBlock({ text, indent = false }: { text: string; indent?: boolean }) {
  return (
    <div
      className="mt-1.5 px-2 py-1 text-[12px] rounded-md whitespace-pre-wrap"
      style={{
        background: 'var(--ink-surface)',
        color: 'var(--ink-text-secondary)',
        borderLeft: '2px solid var(--ink-border)',
        marginLeft: indent ? 8 : 0,
        lineHeight: 1.5,
      }}
    >
      {text}
    </div>
  );
}

// ── Cards ─────────────────────────────────────────────────────────────────

function SignalCard({ signal, huddleId, onChange }: { signal: HuddleSignal; huddleId: string; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(signal.text);
  const [why, setWhy] = useState(signal.whyItMatters ?? '');
  const [details, setDetails] = useState(signal.details ?? '');

  async function promote() {
    setBusy(true);
    try { await api(`/huddles/${huddleId}/signals/${signal.id}/promote`, { method: 'PUT' }); onChange(); }
    finally { setBusy(false); }
  }
  async function del() {
    setBusy(true);
    try { await api(`/huddles/${huddleId}/signals/${signal.id}`, { method: 'DELETE' }); onChange(); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api(`/huddles/${huddleId}/signals/${signal.id}`, {
        method: 'PUT',
        body: {
          text: text.trim(),
          whyItMatters: why.trim() ? why.trim() : null,
          details: details.trim() ? details.trim() : null,
        },
      });
      setEditing(false);
      onChange();
    } finally { setBusy(false); }
  }
  function cancel() {
    setText(signal.text);
    setWhy(signal.whyItMatters ?? '');
    setDetails(signal.details ?? '');
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="rounded-lg p-2.5"
        style={{ background: 'var(--ink-bg)', border: '1px solid var(--ink-accent)' }}>
        <input
          autoFocus value={text} onChange={(e) => setText(e.target.value)}
          className="w-full px-2 py-1.5 text-[13.5px] rounded-md"
          style={{ background: 'var(--ink-surface)', color: 'var(--ink-text)', border: '1px solid var(--ink-border)', outline: 'none' }}
          onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}
        />
        <input
          value={why} onChange={(e) => setWhy(e.target.value)}
          placeholder="Why it matters (optional)"
          className="w-full mt-1 px-2 py-1 text-[12px] rounded-md"
          style={{ background: 'var(--ink-surface)', color: 'var(--ink-text-secondary)', border: '1px solid var(--ink-border)', outline: 'none' }}
        />
        <textarea
          value={details} onChange={(e) => setDetails(e.target.value)}
          placeholder="Notes or details (optional)"
          rows={2}
          className="w-full mt-1 px-2 py-1 text-[12px] rounded-md resize-none"
          style={{ background: 'var(--ink-surface)', color: 'var(--ink-text-secondary)', border: '1px solid var(--ink-border)', outline: 'none' }}
        />
        <div className="flex items-center gap-1.5 mt-1.5">
          <button onClick={save} disabled={!text.trim() || busy}
            className="text-[11.5px] px-2 py-1 rounded-md"
            style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)', fontWeight: 600, opacity: !text.trim() ? 0.5 : 1 }}>
            Save
          </button>
          <button onClick={cancel} className="text-[11.5px]" style={{ color: 'var(--ink-text-muted)' }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group rounded-lg p-2.5"
      style={{ background: 'var(--ink-bg)', border: '1px solid var(--ink-border-subtle)' }}>
      <p className="text-[13.5px]" style={{ color: 'var(--ink-text)', lineHeight: 1.45 }}>{signal.text}</p>
      {signal.whyItMatters && !signal.whyItMatters.startsWith('@') && (
        <p className="text-[12px] mt-1" style={{ color: 'var(--ink-text-muted)', fontStyle: 'italic' }}>
          {signal.whyItMatters}
        </p>
      )}
      {signal.details && <DetailsBlock text={signal.details} />}
      <div className="flex items-center justify-between mt-2">
        <span className="text-[11px]" style={{ color: 'var(--ink-text-faint)' }}>
          {signal.authorName ?? '—'}
        </span>
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {!signal.promotedToTopic ? (
            <button onClick={promote} disabled={busy}
              className="text-[11px] px-2 py-0.5 rounded-md"
              style={{ background: 'var(--ink-accent-light)', color: 'var(--ink-accent)', fontWeight: 600 }}>
              Promote ↗
            </button>
          ) : (
            <span className="text-[11px]" style={{ color: 'var(--ink-text-faint)' }}>promoted</span>
          )}
          <button onClick={() => setEditing(true)} disabled={busy} className="text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>Edit</button>
          <button onClick={del} disabled={busy} className="text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>×</button>
        </div>
      </div>
    </div>
  );
}

function TopicCard({
  topic, participants, huddleId, onChange,
}: { topic: HuddleTopic; participants: HuddleDetail['participants']; huddleId: string; onChange: () => void }) {
  const [decideOpen, setDecideOpen] = useState(false);
  const [decision, setDecision] = useState('');
  const [owner, setOwner] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(topic.title);
  const [context, setContext] = useState(topic.context ?? '');
  const [details, setDetails] = useState(topic.details ?? '');

  async function decide() {
    if (!decision.trim()) return;
    setBusy(true);
    try {
      await api(`/huddles/${huddleId}/topics/${topic.id}/decide`, {
        method: 'POST',
        body: { decisionText: decision.trim(), ownerUserId: owner || null },
      });
      setDecideOpen(false); setDecision(''); setOwner('');
      onChange();
    } finally { setBusy(false); }
  }
  async function park() {
    setBusy(true);
    try { await api(`/huddles/${huddleId}/topics/${topic.id}/park`, { method: 'POST', body: {} }); onChange(); }
    finally { setBusy(false); }
  }
  async function del() {
    if (!confirm('Delete this focus topic? Any decisions on it will be removed too.')) return;
    setBusy(true);
    try { await api(`/huddles/${huddleId}/topics/${topic.id}`, { method: 'DELETE' }); onChange(); }
    finally { setBusy(false); }
  }
  async function saveEdit() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api(`/huddles/${huddleId}/topics/${topic.id}`, {
        method: 'PUT',
        body: {
          title: title.trim(),
          context: context.trim() ? context.trim() : null,
          details: details.trim() ? details.trim() : null,
        },
      });
      setEditing(false);
      onChange();
    } finally { setBusy(false); }
  }
  function cancelEdit() {
    setTitle(topic.title);
    setContext(topic.context ?? '');
    setDetails(topic.details ?? '');
    setEditing(false);
  }

  const stateColor = topic.status === 'decided' ? 'var(--ink-done)' : topic.status === 'parked' ? 'var(--ink-text-faint)' : 'var(--ink-accent)';

  return (
    <div className="group rounded-lg p-2.5"
      style={{
        background: 'var(--ink-bg)',
        border: `1px solid var(--ink-border-subtle)`,
        borderLeft: `2px solid ${stateColor}`,
        opacity: topic.status === 'parked' ? 0.7 : 1,
      }}>
      {editing ? (
        <div className="space-y-1.5">
          <input
            autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full px-2 py-1.5 text-[13.5px] rounded-md"
            style={{ background: 'var(--ink-surface)', color: 'var(--ink-text)', border: '1px solid var(--ink-border)', outline: 'none' }}
            onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
          />
          <textarea
            value={context} onChange={(e) => setContext(e.target.value)}
            placeholder="Context (optional)"
            rows={2}
            className="w-full px-2 py-1 text-[12px] rounded-md resize-none"
            style={{ background: 'var(--ink-surface)', color: 'var(--ink-text-secondary)', border: '1px solid var(--ink-border)', outline: 'none' }}
          />
          <textarea
            value={details} onChange={(e) => setDetails(e.target.value)}
            placeholder="Notes or details (optional)"
            rows={2}
            className="w-full px-2 py-1 text-[12px] rounded-md resize-none"
            style={{ background: 'var(--ink-surface)', color: 'var(--ink-text-secondary)', border: '1px solid var(--ink-border)', outline: 'none' }}
          />
          <div className="flex items-center gap-1.5">
            <button onClick={saveEdit} disabled={!title.trim() || busy}
              className="text-[11.5px] px-2 py-1 rounded-md"
              style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)', fontWeight: 600, opacity: !title.trim() ? 0.5 : 1 }}>
              Save
            </button>
            <button onClick={cancelEdit} className="text-[11.5px]" style={{ color: 'var(--ink-text-muted)' }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="group/topic flex items-start gap-2">
            <p className="flex-1 text-[13.5px] font-medium" style={{ color: 'var(--ink-text)' }}>{topic.title}</p>
            <div className="flex items-center gap-1 opacity-0 group-hover/topic:opacity-100 transition-opacity">
              <button
                onClick={() => setEditing(true)}
                disabled={busy}
                className="text-[11px]"
                style={{ color: 'var(--ink-text-muted)' }}
              >
                Edit
              </button>
              <button
                onClick={del}
                disabled={busy}
                aria-label="Delete topic"
                className="text-[12px] px-1"
                style={{ color: 'var(--ink-text-muted)' }}
              >
                ×
              </button>
            </div>
          </div>
          {topic.context && <p className="text-[12px] mt-1" style={{ color: 'var(--ink-text-muted)' }}>{topic.context}</p>}
          {topic.details && <DetailsBlock text={topic.details} />}
        </>
      )}

      {topic.decisions && topic.decisions.length > 0 && (
        <ul className="mt-2 space-y-1">
          {topic.decisions.map((d) => (
            <DecisionInlineItem key={d.id} decision={d} huddleId={huddleId} onChange={onChange} />
          ))}
        </ul>
      )}

      {topic.status === 'open' && !decideOpen && !editing && (
        <div className="flex items-center gap-1.5 mt-2">
          <button onClick={() => setDecideOpen(true)}
            className="text-[11.5px] px-2 py-0.5 rounded-md"
            style={{ background: 'var(--ink-accent-light)', color: 'var(--ink-accent)', fontWeight: 600 }}>
            Decide
          </button>
          <button onClick={park} disabled={busy}
            className="text-[11.5px] px-2 py-0.5 rounded-md"
            style={{ color: 'var(--ink-text-muted)' }}>
            Park
          </button>
        </div>
      )}

      {decideOpen && (
        <div className="mt-2 space-y-1.5">
          <input
            autoFocus value={decision} onChange={(e) => setDecision(e.target.value)}
            placeholder="The decision is…"
            className="w-full px-2 py-1.5 text-[13px] rounded-md"
            style={{ background: 'var(--ink-surface)', color: 'var(--ink-text)', border: '1px solid var(--ink-border)', outline: 'none' }}
          />
          <select
            value={owner} onChange={(e) => setOwner(e.target.value)}
            className="w-full px-2 py-1.5 text-[12.5px] rounded-md"
            style={{ background: 'var(--ink-surface)', color: 'var(--ink-text)', border: '1px solid var(--ink-border)', outline: 'none' }}
          >
            <option value="">Owner (optional)</option>
            {participants.map((p) => (
              <option key={p.id} value={p.userId ?? ''} disabled={!p.userId}>
                {p.userName ?? p.externalName}{!p.userId ? ' (external)' : ''}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <button onClick={decide} disabled={!decision.trim() || busy}
              className="text-[11.5px] px-2 py-1 rounded-md"
              style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)', fontWeight: 600, opacity: !decision.trim() ? 0.5 : 1 }}>
              Save decision
            </button>
            <button onClick={() => setDecideOpen(false)} className="text-[11.5px]" style={{ color: 'var(--ink-text-muted)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DecisionInlineItem({
  decision, huddleId, onChange,
}: { decision: HuddleDecision; huddleId: string; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(decision.decisionText);
  const [details, setDetails] = useState(decision.details ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api(`/huddles/${huddleId}/decisions/${decision.id}`, {
        method: 'PUT',
        body: {
          decisionText: text.trim(),
          details: details.trim() ? details.trim() : null,
        },
      });
      setEditing(false);
      onChange();
    } finally { setBusy(false); }
  }
  async function del() {
    if (!confirm('Delete this decision?')) return;
    setBusy(true);
    try { await api(`/huddles/${huddleId}/decisions/${decision.id}`, { method: 'DELETE' }); onChange(); }
    finally { setBusy(false); }
  }

  if (editing) {
    return (
      <li className="pl-2" style={{ borderLeft: '2px solid var(--ink-done)' }}>
        <input
          autoFocus value={text} onChange={(e) => setText(e.target.value)}
          className="w-full px-2 py-1 text-[12.5px] rounded-md"
          style={{ background: 'var(--ink-surface)', color: 'var(--ink-text)', border: '1px solid var(--ink-border)', outline: 'none' }}
          onKeyDown={(e) => { if (e.key === 'Escape') { setEditing(false); setText(decision.decisionText); setDetails(decision.details ?? ''); } }}
        />
        <textarea
          value={details} onChange={(e) => setDetails(e.target.value)}
          placeholder="Notes or details (optional)"
          rows={2}
          className="w-full mt-1 px-2 py-1 text-[12px] rounded-md resize-none"
          style={{ background: 'var(--ink-surface)', color: 'var(--ink-text-secondary)', border: '1px solid var(--ink-border)', outline: 'none' }}
        />
        <div className="flex items-center gap-1.5 mt-1">
          <button onClick={save} disabled={!text.trim() || busy}
            className="text-[11px] px-2 py-0.5 rounded-md"
            style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)', fontWeight: 600, opacity: !text.trim() ? 0.5 : 1 }}>
            Save
          </button>
          <button onClick={() => { setEditing(false); setText(decision.decisionText); setDetails(decision.details ?? ''); }}
            className="text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="group/dec text-[12.5px] pl-2"
      style={{ color: 'var(--ink-text)', borderLeft: '2px solid var(--ink-done)' }}>
      <div className="flex items-start gap-2">
        <span className="flex-1">
          ✓ {decision.decisionText}
          {decision.ownerName && <span style={{ color: 'var(--ink-text-muted)' }}> — {decision.ownerName}</span>}
        </span>
        <div className="flex items-center gap-1 opacity-0 group-hover/dec:opacity-100 transition-opacity">
          <button onClick={() => setEditing(true)} disabled={busy}
            className="text-[10.5px]"
            style={{ color: 'var(--ink-text-muted)' }}>
            Edit
          </button>
          <button onClick={del} disabled={busy} aria-label="Delete decision"
            className="text-[12px] px-1"
            style={{ color: 'var(--ink-text-muted)' }}>
            ×
          </button>
        </div>
      </div>
      {decision.details && <DetailsBlock text={decision.details} indent />}
    </li>
  );
}

function DecisionCard({ decision, topic, huddleId, onChange }: { decision: HuddleDecision; topic: HuddleTopic; huddleId: string; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(decision.decisionText);
  const [details, setDetails] = useState(decision.details ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api(`/huddles/${huddleId}/decisions/${decision.id}`, {
        method: 'PUT',
        body: {
          decisionText: text.trim(),
          details: details.trim() ? details.trim() : null,
        },
      });
      setEditing(false);
      onChange();
    } finally { setBusy(false); }
  }
  async function del() {
    if (!confirm('Delete this decision?')) return;
    setBusy(true);
    try { await api(`/huddles/${huddleId}/decisions/${decision.id}`, { method: 'DELETE' }); onChange(); }
    finally { setBusy(false); }
  }
  function cancel() {
    setText(decision.decisionText);
    setDetails(decision.details ?? '');
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="rounded-lg p-2.5"
        style={{ background: 'var(--ink-bg)', border: '1px solid var(--ink-accent)', borderLeft: '2px solid var(--ink-done)' }}>
        <input
          autoFocus value={text} onChange={(e) => setText(e.target.value)}
          className="w-full px-2 py-1.5 text-[13.5px] rounded-md"
          style={{ background: 'var(--ink-surface)', color: 'var(--ink-text)', border: '1px solid var(--ink-border)', outline: 'none' }}
          onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}
        />
        <textarea
          value={details} onChange={(e) => setDetails(e.target.value)}
          placeholder="Notes or details (optional)"
          rows={2}
          className="w-full mt-1 px-2 py-1 text-[12px] rounded-md resize-none"
          style={{ background: 'var(--ink-surface)', color: 'var(--ink-text-secondary)', border: '1px solid var(--ink-border)', outline: 'none' }}
        />
        <div className="flex items-center gap-1.5 mt-1.5">
          <button onClick={save} disabled={!text.trim() || busy}
            className="text-[11.5px] px-2 py-1 rounded-md"
            style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)', fontWeight: 600, opacity: !text.trim() ? 0.5 : 1 }}>
            Save
          </button>
          <button onClick={cancel} className="text-[11.5px]" style={{ color: 'var(--ink-text-muted)' }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group rounded-lg p-2.5"
      style={{ background: 'var(--ink-bg)', border: '1px solid var(--ink-border-subtle)', borderLeft: '2px solid var(--ink-done)' }}>
      <div className="flex items-start gap-2">
        <p className="flex-1 text-[13.5px]" style={{ color: 'var(--ink-text)', lineHeight: 1.45 }}>{decision.decisionText}</p>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => setEditing(true)} disabled={busy}
            className="text-[11px]"
            style={{ color: 'var(--ink-text-muted)' }}>
            Edit
          </button>
          <button onClick={del} disabled={busy} aria-label="Delete decision"
            className="text-[12px] px-1"
            style={{ color: 'var(--ink-text-muted)' }}>
            ×
          </button>
        </div>
      </div>
      {decision.details && <DetailsBlock text={decision.details} />}
      <div className="flex items-center justify-between mt-1.5 text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
        <span style={{ fontStyle: 'italic' }}>↳ {topic.title}</span>
        {decision.ownerName && <span>{decision.ownerName}</span>}
      </div>
    </div>
  );
}

function IntentionCard({
  intention, huddleId, workspaces, huddleWorkspaceId, onChange,
}: {
  intention: HuddleIntention; huddleId: string; workspaces: Workspace[]; huddleWorkspaceId: string | null; onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [wid, setWid] = useState<string>(huddleWorkspaceId ?? workspaces[0]?.id ?? '');
  const [priority, setPriority] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(intention.text);
  const [due, setDue] = useState(intention.softDueText ?? '');
  const [details, setDetails] = useState(intention.details ?? '');
  const done = intention.status === 'done';

  async function complete() {
    setBusy(true);
    try { await api(`/huddles/${huddleId}/intentions/${intention.id}/complete`, { method: 'POST', body: {} }); onChange(); }
    finally { setBusy(false); }
  }
  async function del() {
    if (!confirm('Delete this intention?')) return;
    setBusy(true);
    try { await api(`/huddles/${huddleId}/intentions/${intention.id}`, { method: 'DELETE' }); onChange(); }
    finally { setBusy(false); }
  }
  async function convert() {
    if (!wid) return;
    setBusy(true);
    try {
      await api(`/huddles/${huddleId}/intentions/${intention.id}/convert`, {
        method: 'POST', body: { workspaceId: wid, priorityForToday: priority },
      });
      setConvertOpen(false);
      onChange();
    } finally { setBusy(false); }
  }
  async function saveEdit() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api(`/huddles/${huddleId}/intentions/${intention.id}`, {
        method: 'PUT',
        body: {
          text: text.trim(),
          softDueText: due.trim() ? due.trim() : null,
          details: details.trim() ? details.trim() : null,
        },
      });
      setEditing(false);
      onChange();
    } finally { setBusy(false); }
  }
  function cancelEdit() {
    setText(intention.text);
    setDue(intention.softDueText ?? '');
    setDetails(intention.details ?? '');
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="rounded-lg p-2.5"
        style={{ background: 'var(--ink-bg)', border: '1px solid var(--ink-accent)' }}>
        <input
          autoFocus value={text} onChange={(e) => setText(e.target.value)}
          className="w-full px-2 py-1.5 text-[13.5px] rounded-md"
          style={{ background: 'var(--ink-surface)', color: 'var(--ink-text)', border: '1px solid var(--ink-border)', outline: 'none' }}
          onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
        />
        <input
          value={due} onChange={(e) => setDue(e.target.value)}
          placeholder="When? (e.g. by Friday)"
          className="w-full mt-1 px-2 py-1 text-[12px] rounded-md"
          style={{ background: 'var(--ink-surface)', color: 'var(--ink-text-secondary)', border: '1px solid var(--ink-border)', outline: 'none' }}
        />
        <textarea
          value={details} onChange={(e) => setDetails(e.target.value)}
          placeholder="Notes or details (optional)"
          rows={2}
          className="w-full mt-1 px-2 py-1 text-[12px] rounded-md resize-none"
          style={{ background: 'var(--ink-surface)', color: 'var(--ink-text-secondary)', border: '1px solid var(--ink-border)', outline: 'none' }}
        />
        <div className="flex items-center gap-1.5 mt-1.5">
          <button onClick={saveEdit} disabled={!text.trim() || busy}
            className="text-[11.5px] px-2 py-1 rounded-md"
            style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)', fontWeight: 600, opacity: !text.trim() ? 0.5 : 1 }}>
            Save
          </button>
          <button onClick={cancelEdit} className="text-[11.5px]" style={{ color: 'var(--ink-text-muted)' }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group rounded-lg p-2.5"
      style={{
        background: 'var(--ink-bg)', border: '1px solid var(--ink-border-subtle)',
        opacity: done ? 0.6 : 1,
      }}>
      <div className="flex items-start gap-2">
        <button
          onClick={complete}
          disabled={busy || done}
          aria-label="Mark done"
          style={{
            width: 16, height: 16, marginTop: 3, borderRadius: 4,
            border: `1.5px solid ${done ? 'var(--ink-done)' : 'var(--ink-border)'}`,
            background: done ? 'var(--ink-done)' : 'transparent',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >
          {done && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          )}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px]" style={{ color: 'var(--ink-text)', lineHeight: 1.45, textDecoration: done ? 'line-through' : 'none' }}>
            {intention.text}
          </p>
          <div className="flex items-center gap-2 mt-1 text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
            {intention.ownerName && <span>{intention.ownerName}</span>}
            {intention.softDueText && <span>· {intention.softDueText}</span>}
            {intention.linkedTaskId && (
              <span style={{ color: 'var(--ink-accent)' }}>· task created</span>
            )}
          </div>
          {intention.details && <DetailsBlock text={intention.details} />}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!done && (
            <button onClick={() => setEditing(true)} disabled={busy}
              className="text-[11px]"
              style={{ color: 'var(--ink-text-muted)' }}>
              Edit
            </button>
          )}
          <button onClick={del} disabled={busy} aria-label="Delete intention"
            className="text-[12px] px-1"
            style={{ color: 'var(--ink-text-muted)' }}>
            ×
          </button>
        </div>
      </div>

      {!done && !intention.linkedTaskId && (
        <div className="mt-2">
          {!convertOpen ? (
            <button
              onClick={() => setConvertOpen(true)}
              className="text-[11px] px-2 py-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'var(--ink-accent-light)', color: 'var(--ink-accent)', fontWeight: 600 }}
            >
              → Convert to task
            </button>
          ) : (
            <div className="space-y-1.5 p-2 rounded-md" style={{ background: 'var(--ink-surface)' }}>
              <select
                value={wid} onChange={(e) => setWid(e.target.value)}
                className="w-full px-2 py-1 text-[12px] rounded-md"
                style={{ background: 'var(--ink-bg)', color: 'var(--ink-text)', border: '1px solid var(--ink-border)' }}
              >
                {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--ink-text-secondary)' }}>
                <input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} />
                Set as today’s priority
              </label>
              <div className="flex items-center gap-1.5">
                <button onClick={convert} disabled={busy || !wid}
                  className="text-[11.5px] px-2 py-1 rounded-md"
                  style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)', fontWeight: 600 }}>
                  Create task
                </button>
                <button onClick={() => setConvertOpen(false)} className="text-[11.5px]" style={{ color: 'var(--ink-text-muted)' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FollowupCard({
  followup, huddleId, onChange,
}: { followup: HuddleFollowup; huddleId: string; onChange: () => void }) {
  const done = followup.status === 'done';
  async function toggle() {
    await api(`/huddles/${huddleId}/followups/${followup.id}`, {
      method: 'PUT', body: { status: done ? 'open' : 'done' },
    });
    onChange();
  }
  async function del() {
    if (!confirm('Delete this follow-up?')) return;
    await api(`/huddles/${huddleId}/followups/${followup.id}`, { method: 'DELETE' });
    onChange();
  }
  return (
    <div className="group flex items-start gap-2 px-2.5 py-1.5 rounded-md"
      style={{ background: 'var(--ink-bg)', border: '1px solid var(--ink-border-subtle)', opacity: done ? 0.55 : 1 }}>
      <button
        onClick={toggle}
        aria-label="Toggle"
        style={{
          width: 14, height: 14, marginTop: 3, borderRadius: 3,
          border: `1.5px solid ${done ? 'var(--ink-done)' : 'var(--ink-border)'}`,
          background: done ? 'var(--ink-done)' : 'transparent', flexShrink: 0,
        }}
      />
      <div className="flex-1">
        <p className="text-[12.5px]" style={{ color: 'var(--ink-text)', textDecoration: done ? 'line-through' : 'none' }}>
          {followup.text}
        </p>
        <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>
          {followup.ownerName ?? '—'}
          {followup.reviewDate && <> · review {followup.reviewDate}</>}
          {followup.carriedFromHuddleId && <> · carried forward</>}
        </div>
      </div>
      <button onClick={del} aria-label="Delete follow-up"
        className="text-[12px] px-1 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: 'var(--ink-text-muted)' }}>
        ×
      </button>
    </div>
  );
}
