'use client';

/**
 * Zentra — Guide & Help
 *
 * A single page that gives a user:
 *   • a readable user guide (how Zentra works, what each space does)
 *   • a calm way to contact us (open a support ticket)
 *   • a list of the tickets they've opened and our responses
 *
 * The URL is intentionally /help, not /support, so the feel stays like
 * reading a guide rather than filing a complaint.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import AuthenticatedLayout from '@/components/layout/AuthShell';
import { useTour, resetTour } from '@/lib/useTour';

type Tab = 'guide' | 'contact' | 'tickets';

interface Ticket {
  id: string;
  category: string;
  subject: string;
  message: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: string;
  staffResponse: string | null;
  respondedAt: string | null;
  createdAt: string;
}

const CATEGORIES: Array<{ value: string; label: string; hint: string }> = [
  { value: 'question', label: 'A question', hint: 'You just want to understand how something works.' },
  { value: 'bug', label: 'Something is broken', hint: 'A screen, button, or action is not behaving the way it should.' },
  { value: 'feedback', label: 'An idea or feedback', hint: 'A small wish, a rough edge, or a thought about where Zentra should go.' },
  { value: 'account', label: 'My account', hint: 'Login, email, password, 2FA, or anything related to access.' },
  { value: 'other', label: 'Something else', hint: 'It does not fit anywhere above — and that is fine.' },
];

export default function HelpPage() {
  const [tab, setTab] = useState<Tab>('guide');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);

  // Ticket form
  const [category, setCategory] = useState('question');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== 'tickets') return;
    setLoadingTickets(true);
    api<{ items: Ticket[] }>('/support/tickets')
      .then((d) => setTickets(d.items))
      .catch(() => setTickets([]))
      .finally(() => setLoadingTickets(false));
  }, [tab]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (subject.trim().length < 3) {
      setFormError('Give it a short subject (at least 3 characters).');
      return;
    }
    if (message.trim().length < 10) {
      setFormError('Describe what is happening with a little more detail.');
      return;
    }
    setSubmitting(true);
    try {
      const appUrl = typeof window !== 'undefined' ? window.location.href : undefined;
      await api('/support/tickets', {
        method: 'POST',
        body: {
          category,
          subject: subject.trim(),
          message: message.trim(),
          appUrl,
        },
      });
      setSubmitted(true);
      setSubject('');
      setMessage('');
      setCategory('question');
    } catch (err: any) {
      setFormError(err?.message || 'We could not send that just now. Please try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthenticatedLayout>
      <div
        className="mx-auto w-full"
        style={{ maxWidth: 820, padding: '40px 24px 96px' }}
      >
        {/* ── Header ── */}
        <header style={{ marginBottom: 32 }}>
          <p
            style={{
              fontSize: '0.72rem',
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: 'var(--ink-text-muted)',
              marginBottom: 10,
            }}
          >
            Guide &amp; help
          </p>
          <h1
            style={{
              fontSize: '1.9rem',
              fontWeight: 300,
              letterSpacing: '-0.01em',
              color: 'var(--ink-text)',
              margin: 0,
            }}
          >
            Everything you need to move calmly through Zentra.
          </h1>
          <p
            style={{
              marginTop: 12,
              fontSize: '0.9375rem',
              lineHeight: 1.7,
              color: 'var(--ink-text-secondary)',
            }}
          >
            Read the guide when you want to understand the app. Write us when you
            want a human. No queues, no tickets of yours forgotten in a backlog.
          </p>
        </header>

        {/* ── Tabs ── */}
        <div
          role="tablist"
          style={{
            display: 'flex',
            gap: 4,
            borderBottom: '1px solid var(--ink-border-subtle)',
            marginBottom: 32,
          }}
        >
          {(
            [
              { id: 'guide', label: 'User guide' },
              { id: 'contact', label: 'Contact us' },
              { id: 'tickets', label: 'My conversations' },
            ] as Array<{ id: Tab; label: string }>
          ).map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '12px 16px',
                  fontSize: '0.875rem',
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--ink-text)' : 'var(--ink-text-muted)',
                  borderBottom: active ? '2px solid var(--ink-accent)' : '2px solid transparent',
                  marginBottom: -1,
                  cursor: 'pointer',
                  minHeight: 44,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'guide' && <GuideContent />}

        {tab === 'guide' && <TourReplayBlock />}

        {tab === 'contact' && (
          <ContactForm
            category={category}
            setCategory={setCategory}
            subject={subject}
            setSubject={setSubject}
            message={message}
            setMessage={setMessage}
            submitting={submitting}
            submitted={submitted}
            setSubmitted={setSubmitted}
            formError={formError}
            onSubmit={handleSubmit}
            onViewTickets={() => setTab('tickets')}
          />
        )}

        {tab === 'tickets' && (
          <TicketsList tickets={tickets} loading={loadingTickets} onWrite={() => setTab('contact')} />
        )}
      </div>
    </AuthenticatedLayout>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/*  Guide content                                                   */
/* ─────────────────────────────────────────────────────────────── */

function TourReplayBlock() {
  const start = useTour((s) => s.start);
  const setLegend = useTour((s) => s.setLegend);
  return (
    <div
      style={{
        marginTop: 24,
        padding: 18,
        borderRadius: 14,
        border: '1px solid var(--ink-border-subtle)',
        background: 'var(--ink-surface)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ minWidth: 220, flex: '1 1 240px' }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>Show me around again</h3>
        <p style={{ margin: '4px 0 0', fontSize: '0.825rem', color: 'var(--ink-text-muted)' }}>
          Replay the walkthrough or hover any section to see what it does.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => setLegend(true)}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid var(--ink-border)',
            background: 'transparent',
            color: 'var(--ink-text)',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Hover legend
        </button>
        <button
          onClick={() => { resetTour(); start(); }}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--ink-accent)',
            color: 'var(--ink-on-accent)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Replay tour
        </button>
      </div>
    </div>
  );
}

function GuideContent() {
  return (
    <article
      style={{
        fontSize: '0.9375rem',
        lineHeight: 1.75,
        color: 'var(--ink-text)',
      }}
    >
      <Section title="What Zentra is">
        <P>
          Zentra is a quiet place to decide what matters, do the one next thing,
          and put the day down at the end. It is built around four simple
          spaces — <b>Flow</b>, <b>Studio</b>, <b>Lists</b>, and <b>Echoes</b> —
          and a short ritual called <b>Reflect</b>.
        </P>
        <P>
          You do not need to learn a system to use Zentra. If you open it in
          the morning and close it in the evening, it will already be helping.
        </P>
      </Section>

      <Section title="Flow — your today">
        <P>
          Flow is the default screen. It shows what deserves your attention
          today: the one thing you chose as your priority, anything you pulled
          in from other spaces, and — when you start a focus session — the
          work you are doing right now.
        </P>
        <Bullets>
          <li>Tap a task to open it. Tap again to mark it complete.</li>
          <li>
            Press <em>Start focus</em> to run a 15, 25, or 50-minute session.
            Zentra dims everything else and keeps a small timer with you.
          </li>
          <li>
            If you get stuck, use <em>Move on</em>. It is not failure — it is
            useful information about what was in your way.
          </li>
        </Bullets>
      </Section>

      <Section title="Studio — your spaces">
        <P>
          Studio is where life lives. Each <em>Space</em> is an area of your
          world: Work, Personal, a project, a relationship, a home. Inside a
          Space you get a flexible <b>Canvas</b> where you can arrange notes,
          tasks, a planner, and appointments together.
        </P>
        <Bullets>
          <li>Create a new Space from Studio → New.</li>
          <li>Switch Spaces from the dropdown next to the logo.</li>
          <li>
            <em>Waiting on…</em> holds tasks blocked by someone or something
            else — out of your head, but not out of sight.
          </li>
          <li>
            <em>Archive</em> keeps done and dropped items without deleting
            your history.
          </li>
        </Bullets>
      </Section>

      <Section title="Lists — capture and plan">
        <P>
          Lists are for things that are not yet a task: groceries, a trip,
          books to read, a household inventory. You can add items by typing,
          by voice, or by <b>AI Import</b> (paste a recipe or a screenshot and
          Zentra will structure it for you).
        </P>
        <Bullets>
          <li>
            Shopping lists show insights over time — what you tend to buy,
            how often, and where it fits in your week.
          </li>
          <li>
            Any list item can be promoted into a task when it becomes
            something to actually do.
          </li>
        </Bullets>
      </Section>

      <Section title="Echoes — gentle reminders">
        <P>
          Echoes are soft, time-based nudges. They live outside your task
          list so they do not add noise to what you are doing. Use them for
          things like <em>“refill prescription”</em>, <em>“call Mom on Sunday”</em>,
          or <em>“check the laundry in 40 minutes”</em>.
        </P>
      </Section>

      <Section title="Reflect — closing the day">
        <P>
          Reflect is a 60-second ritual you do when you are done for the day.
          It asks three things: what you completed, what you chose not to do
          on purpose, and how you feel. Then it lets you choose one priority
          for tomorrow.
        </P>
        <P>
          The goal is not metrics. It is to put the day down cleanly, so you
          can rest.
        </P>
      </Section>

      <Section title="Focus sessions">
        <P>
          A focus session is a short, protected stretch of time. You choose
          the task and the length (15, 25, or 50 minutes). Zentra keeps a
          small timer, holds notifications back, and logs how it went.
        </P>
        <Bullets>
          <li>You can extend by +15 or +25 minutes if you are in flow.</li>
          <li>You can end early without any judgment or streak loss.</li>
          <li>
            <em>Move on</em> tells Zentra why you are stopping so it can help
            you plan better next time.
          </li>
        </Bullets>
      </Section>

      <Section title="AI helpers">
        <P>
          Zentra includes optional AI helpers: text import, image import, and
          a suggestion assistant. You control whether they run, and nothing
          from your data is used to train external models.
        </P>
        <Bullets>
          <li>Turn AI on or off from <b>Settings → Zentra preferences</b>.</li>
          <li>
            AI suggestions are always prefaced with <em>“suggestion”</em> and
            never auto-apply.
          </li>
        </Bullets>
      </Section>

      <Section title="Account &amp; security">
        <Bullets>
          <li>
            Sign in with email and password, or with Google. Both can be
            linked to the same account.
          </li>
          <li>
            Verify your email from the banner at the top when you first sign
            up. It unlocks reminders and ticket notifications.
          </li>
          <li>
            Turn on <b>two-factor authentication</b> from{' '}
            <a href="/settings" style={{ color: 'var(--ink-accent)' }}>Settings → Security</a>.
            You will be given one-time recovery codes — save them somewhere safe.
          </li>
          <li>
            Forgot your password? Use <a href="/forgot" style={{ color: 'var(--ink-accent)' }}>Forgot password</a> to receive a reset link.
          </li>
        </Bullets>
      </Section>

      <Section title="Keyboard shortcuts">
        <Bullets>
          <li><Kbd>N</Kbd> — new task in the current space</li>
          <li><Kbd>/</Kbd> — focus the search bar</li>
          <li><Kbd>F</Kbd> — start a focus session on the selected task</li>
          <li><Kbd>Esc</Kbd> — close modals and drawers</li>
          <li><Kbd>G</Kbd> then <Kbd>F</Kbd> — go to Flow</li>
          <li><Kbd>G</Kbd> then <Kbd>R</Kbd> — go to Reflect</li>
        </Bullets>
      </Section>

      <Section title="Privacy">
        <P>
          Your data is yours. Tasks, lists, reflections, and focus sessions
          are stored privately under your account and never sold. You can
          request an export or deletion at any time from{' '}
          <a href="/settings" style={{ color: 'var(--ink-accent)' }}>Settings</a>.
        </P>
      </Section>

      <Section title="Still stuck?">
        <P>
          If something in this guide is not answering your question, that is
          not your fault — it is ours. Write to us from the{' '}
          <b>Contact us</b> tab above and a real human will reply.
        </P>
      </Section>
    </article>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/*  Contact form                                                    */
/* ─────────────────────────────────────────────────────────────── */

function ContactForm(props: {
  category: string;
  setCategory: (v: string) => void;
  subject: string;
  setSubject: (v: string) => void;
  message: string;
  setMessage: (v: string) => void;
  submitting: boolean;
  submitted: boolean;
  setSubmitted: (v: boolean) => void;
  formError: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onViewTickets: () => void;
}) {
  if (props.submitted) {
    return (
      <div
        style={{
          border: '1px solid var(--ink-border-subtle)',
          borderRadius: 14,
          padding: '28px 24px',
          background: 'var(--ink-surface)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '2rem', marginBottom: 12, opacity: 0.85 }}>✓</div>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 500, margin: 0, color: 'var(--ink-text)' }}>
          We received your message.
        </h2>
        <p
          style={{
            marginTop: 10,
            fontSize: '0.9375rem',
            lineHeight: 1.7,
            color: 'var(--ink-text-secondary)',
            maxWidth: 520,
            margin: '10px auto 0',
          }}
        >
          A human will read this and get back to you — usually within one
          working day. You will see their reply on the <b>My conversations</b> tab.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 22 }}>
          <button
            type="button"
            onClick={props.onViewTickets}
            className="z-btn z-btn-primary"
            style={{ padding: '10px 20px', fontSize: '0.875rem' }}
          >
            View my conversations
          </button>
          <button
            type="button"
            onClick={() => props.setSubmitted(false)}
            className="z-btn"
            style={{ padding: '10px 20px', fontSize: '0.875rem' }}
          >
            Write another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={props.onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <p
        style={{
          fontSize: '0.9375rem',
          lineHeight: 1.7,
          color: 'var(--ink-text-secondary)',
          margin: 0,
        }}
      >
        Tell us what is going on. The more you share, the better we can help —
        but a single sentence is also completely fine.
      </p>

      {/* Category */}
      <Field label="What is this about?">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {CATEGORIES.map((c) => {
            const active = props.category === c.value;
            return (
              <label
                key={c.value}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: active
                    ? '1px solid var(--ink-accent)'
                    : '1px solid var(--ink-border-subtle)',
                  background: active ? 'var(--ink-accent-light)' : 'transparent',
                  cursor: 'pointer',
                  minHeight: 44,
                }}
              >
                <input
                  type="radio"
                  name="category"
                  value={c.value}
                  checked={active}
                  onChange={() => props.setCategory(c.value)}
                  style={{ marginTop: 3, accentColor: 'var(--ink-accent)' }}
                />
                <div>
                  <div
                    style={{
                      fontSize: '0.9375rem',
                      fontWeight: active ? 600 : 500,
                      color: 'var(--ink-text)',
                    }}
                  >
                    {c.label}
                  </div>
                  <div
                    style={{
                      fontSize: '0.8125rem',
                      color: 'var(--ink-text-muted)',
                      marginTop: 2,
                    }}
                  >
                    {c.hint}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </Field>

      {/* Subject */}
      <Field label="Subject" hint="A short summary — one line is enough.">
        <input
          type="text"
          value={props.subject}
          onChange={(e) => props.setSubject(e.target.value)}
          placeholder="e.g. Reminder did not fire last night"
          maxLength={160}
          className="z-input"
          style={{ width: '100%' }}
        />
      </Field>

      {/* Message */}
      <Field
        label="Tell us more"
        hint="What were you trying to do, what happened, and what did you expect instead?"
      >
        <textarea
          value={props.message}
          onChange={(e) => props.setMessage(e.target.value)}
          rows={7}
          maxLength={5000}
          className="z-input"
          style={{ width: '100%', resize: 'vertical', minHeight: 140, fontFamily: 'inherit' }}
          placeholder="Take your time."
        />
        <div
          style={{
            textAlign: 'right',
            fontSize: '0.75rem',
            color: 'var(--ink-text-faint)',
            marginTop: 4,
          }}
        >
          {props.message.length} / 5000
        </div>
      </Field>

      {props.formError && (
        <div
          role="alert"
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid var(--ink-border)',
            background: 'var(--ink-surface)',
            color: 'var(--ink-blocked, var(--ink-text))',
            fontSize: '0.875rem',
          }}
        >
          {props.formError}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button
          type="submit"
          disabled={props.submitting}
          className="z-btn z-btn-primary"
          style={{
            padding: '12px 22px',
            fontSize: '0.9375rem',
            opacity: props.submitting ? 0.7 : 1,
          }}
        >
          {props.submitting ? 'Sending…' : 'Send message'}
        </button>
      </div>
    </form>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/*  Tickets list                                                    */
/* ─────────────────────────────────────────────────────────────── */

function TicketsList({
  tickets,
  loading,
  onWrite,
}: {
  tickets: Ticket[];
  loading: boolean;
  onWrite: () => void;
}) {
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink-text-muted)' }}>
        Loading your conversations…
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div
        style={{
          border: '1px dashed var(--ink-border-subtle)',
          borderRadius: 14,
          padding: '32px 24px',
          textAlign: 'center',
        }}
      >
        <p style={{ color: 'var(--ink-text)', fontSize: '1rem', margin: 0 }}>
          You have not written to us yet.
        </p>
        <p
          style={{
            color: 'var(--ink-text-muted)',
            fontSize: '0.875rem',
            marginTop: 6,
            marginBottom: 18,
          }}
        >
          When you do, your messages and our replies will live here.
        </p>
        <button type="button" onClick={onWrite} className="z-btn z-btn-primary" style={{ padding: '10px 18px', fontSize: '0.875rem' }}>
          Write your first message
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {tickets.map((t) => (
        <TicketCard key={t.id} ticket={t} />
      ))}
    </div>
  );
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  const [expanded, setExpanded] = useState(false);
  const statusLabel = {
    open: 'Open',
    in_progress: 'Looking into it',
    resolved: 'Resolved',
    closed: 'Closed',
  }[ticket.status];
  const statusColor =
    ticket.status === 'resolved' || ticket.status === 'closed'
      ? 'var(--ink-text-muted)'
      : 'var(--ink-accent)';

  const created = new Date(ticket.createdAt);
  const when = created.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div
      style={{
        border: '1px solid var(--ink-border-subtle)',
        borderRadius: 14,
        background: 'var(--ink-surface)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          textAlign: 'left',
          padding: '16px 18px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: '0.95rem',
              fontWeight: 500,
              color: 'var(--ink-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {ticket.subject}
          </div>
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--ink-text-muted)',
              marginTop: 4,
              display: 'flex',
              gap: 10,
              alignItems: 'center',
            }}
          >
            <span style={{ color: statusColor, fontWeight: 500 }}>{statusLabel}</span>
            <span aria-hidden>·</span>
            <span>{when}</span>
          </div>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          style={{
            color: 'var(--ink-text-muted)',
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 160ms ease',
            flexShrink: 0,
          }}
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div style={{ padding: '0 18px 18px' }}>
          <div
            style={{
              padding: '14px 16px',
              background: 'var(--ink-bg)',
              borderRadius: 10,
              fontSize: '0.875rem',
              lineHeight: 1.65,
              color: 'var(--ink-text-secondary)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {ticket.message}
          </div>

          {ticket.staffResponse && (
            <div
              style={{
                marginTop: 12,
                padding: '14px 16px',
                background: 'var(--ink-accent-light)',
                borderRadius: 10,
                fontSize: '0.875rem',
                lineHeight: 1.65,
                color: 'var(--ink-text)',
                whiteSpace: 'pre-wrap',
              }}
            >
              <div
                style={{
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                  color: 'var(--ink-accent)',
                  fontWeight: 600,
                  marginBottom: 6,
                }}
              >
                Zentra team
              </div>
              {ticket.staffResponse}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/*  Small presentational helpers                                    */
/* ─────────────────────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2
        style={{
          fontSize: '1.05rem',
          fontWeight: 600,
          letterSpacing: '-0.005em',
          color: 'var(--ink-text)',
          margin: '0 0 10px',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: '0 0 12px', color: 'var(--ink-text-secondary)' }}>
      {children}
    </p>
  );
}

function Bullets({ children }: { children: React.ReactNode }) {
  return (
    <ul
      style={{
        margin: '6px 0 12px',
        paddingLeft: 22,
        color: 'var(--ink-text-secondary)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {children}
    </ul>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        fontSize: '0.75rem',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        border: '1px solid var(--ink-border-subtle)',
        borderBottomWidth: 2,
        borderRadius: 6,
        background: 'var(--ink-surface)',
        color: 'var(--ink-text)',
        marginRight: 2,
      }}
    >
      {children}
    </kbd>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: '0.8125rem',
          fontWeight: 500,
          color: 'var(--ink-text)',
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      {hint && (
        <div
          style={{
            fontSize: '0.8125rem',
            color: 'var(--ink-text-muted)',
            marginBottom: 8,
          }}
        >
          {hint}
        </div>
      )}
      {children}
    </div>
  );
}
