'use client';

/**
 * Zentra — Welcome / Cover Page
 *
 * The public entry point. Introduces the philosophy before the product:
 *   • Why Zentra exists
 *   • What it helps you with
 *   • The science and the stillness behind it
 *   • How a day inside Zentra actually feels
 *
 * Visual language matches the Completion Ritual: warm backdrop with a slow
 * radial breath, generous whitespace, soft typography, a single primary CTA.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function WelcomePage() {
  // Tiny breathing animation on the sigil, tied to real seconds so it feels
  // tied to the user's own breath, not a UI tick.
  const [breath, setBreath] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setBreath((b) => (b + 1) % 2), 4200);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        width: '100%',
        color: 'var(--ink-text)',
        background:
          'radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--ink-accent) 10%, transparent) 0%, transparent 55%), var(--ink-bg-soft, var(--ink-bg))',
        overflow: 'hidden',
      }}
    >
      {/* Slow breathing glow overlay — the page itself inhales/exhales. */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--ink-accent) 9%, transparent) 0%, transparent 60%)',
          opacity: breath === 0 ? 0.9 : 0.55,
          transition: 'opacity 4200ms ease-in-out',
        }}
      />

      {/* ── Top bar ── */}
      <header
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '22px 28px',
          maxWidth: 1200,
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img
            src="/zentra_logo_azul.png"
            alt="Zentra"
            style={{ height: 56, width: 'auto', display: 'block' }}
          />
        </div>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <a
            href="#why"
            style={{ fontSize: '0.8125rem', color: 'var(--ink-text-muted)', textDecoration: 'none' }}
          >
            Why Zentra
          </a>
          <a
            href="#how"
            style={{ fontSize: '0.8125rem', color: 'var(--ink-text-muted)', textDecoration: 'none' }}
          >
            How it works
          </a>
          <a
            href="#science"
            style={{ fontSize: '0.8125rem', color: 'var(--ink-text-muted)', textDecoration: 'none' }}
          >
            The science
          </a>
          <Link
            href="/login"
            className="z-btn z-btn-primary z-btn-sm"
            style={{ textDecoration: 'none' }}
          >
            Enter Zentra
          </Link>
        </nav>
      </header>

      {/* ── Hero ── */}
      <section
        style={{
          position: 'relative',
          maxWidth: 820,
          margin: '0 auto',
          padding: '88px 24px 120px',
          textAlign: 'center',
        }}
      >
        <p
          style={{
            fontSize: '0.75rem',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--ink-text-muted)',
            marginBottom: 28,
          }}
        >
          A calm operating system for your day
        </p>
        <h1
          style={{
            fontSize: 'clamp(2.5rem, 5.5vw, 4rem)',
            fontWeight: 300,
            lineHeight: 1.08,
            letterSpacing: '-0.02em',
            margin: 0,
            color: 'color-mix(in srgb, var(--ink-text) 92%, transparent)',
          }}
        >
          Do the one thing
          <br />
          that actually matters.
        </h1>
        <p
          style={{
            maxWidth: 560,
            margin: '28px auto 0',
            fontSize: '1.125rem',
            lineHeight: 1.7,
            color: 'var(--ink-text-muted)',
          }}
        >
          Zentra is a planner built on how the brain really works — one task at a time,
          one breath at a time. No streaks. No noise. No guilt. Just a quieter way to move
          your life forward.
        </p>
        <div
          style={{
            marginTop: 44,
            display: 'flex',
            gap: 14,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Link
            href="/signup"
            className="z-btn z-btn-primary"
            style={{ padding: '12px 28px', fontSize: '0.9375rem', textDecoration: 'none' }}
          >
            Begin your first flow
          </Link>
          <Link
            href="/login"
            className="z-btn"
            style={{ padding: '12px 28px', fontSize: '0.9375rem', textDecoration: 'none' }}
          >
            I already have an account
          </Link>
        </div>
        <p style={{ marginTop: 22, fontSize: '0.75rem', color: 'var(--ink-text-faint)' }}>
          Free while in early access · No credit card · Built for humans, not metrics
        </p>
      </section>

      {/* ── Why Zentra ── */}
      <Section id="why" eyebrow="The origin" title="Born from the noise of modern to‑do lists.">
        <P>
          Most productivity apps treat you like a queue — a stack of unfinished tickets that
          only grows. Zentra was born from the opposite question: <em>what if the app helped
          you do <b>less</b>, on purpose?</em>
        </P>
        <P>
          The first version began as a private ritual — a single screen that asked one
          question every morning: <em>&ldquo;What&rsquo;s the one thing you want to move forward today?&rdquo;</em>
          Then it hid everything else.
        </P>
        <P>
          That ritual became Zentra: a quiet companion for people who are tired of juggling
          notifications, Pomodoro timers, and five competing planners — and who want to
          come back to <b>clarity, presence, and momentum</b>.
        </P>
      </Section>

      {/* ── Principles ── */}
      <Section
        eyebrow="The philosophy"
        title="Four principles the product is built on."
      >
        <Grid>
          <Principle
            kicker="01"
            title="One thing at a time"
            body="Your brain is not a tab bar. Zentra surfaces a single priority and treats everything else as background — until you&rsquo;re ready."
          />
          <Principle
            kicker="02"
            title="Start before you&rsquo;re ready"
            body="Procrastination is a dopamine problem, not a willpower problem. We make starting the easiest possible thing — and starting is where momentum lives."
          />
          <Principle
            kicker="03"
            title="Rituals, not streaks"
            body="No shame metrics. No red marks. The day opens with intention and closes with reflection, the way an actual day does."
          />
          <Principle
            kicker="04"
            title="Gentle friction, not notifications"
            body="Zentra asks instead of interrupts. Soft nudges, breathing visuals, and quiet prompts — never a red badge screaming for attention."
          />
        </Grid>
      </Section>

      {/* ── How it works ── */}
      <Section id="how" eyebrow="A day in Zentra" title="How a real day actually flows.">
        <Steps>
          <Step
            n="Morning"
            title="Choose the one thing"
            body="Open Flow. You&rsquo;re greeted by a blank sky and a single question: what matters most today? Zentra helps you commit to one priority — not ten."
          />
          <Step
            n="Focus"
            title="Enter a Flow session"
            body="Press Start. A breathing timer holds the space. Notifications fade. The only thing on screen is the thing you chose."
          />
          <Step
            n="In between"
            title="Gentle check‑ins"
            body="After a session Zentra asks how it went — not to grade you, but so your future plans get smarter. Over time it learns your real rhythm."
          />
          <Step
            n="Evening"
            title="A quiet completion ritual"
            body="At end of day, Zentra offers a short reflection: what pulled you away, what went well, what to carry into tomorrow. Then it closes the day on your behalf."
          />
          <Step
            n="Tomorrow"
            title="Prepare, don&rsquo;t panic"
            body="A two‑minute planner for the next day — just enough so you can set the phone down and actually rest."
          />
        </Steps>
      </Section>

      {/* ── The Science ── */}
      <Section
        id="science"
        eyebrow="The science behind the stillness"
        title="Built on how your brain actually wants to work."
      >
        <P>
          Zentra is grounded in contemporary neuroscience on motivation, focus, and
          dopamine regulation — including Andrew Huberman&rsquo;s work on leveraging
          dopamine to overcome procrastination, and classic research on single‑tasking,
          attention residue, and ultradian rhythms.
        </P>
        <Grid>
          <Principle
            kicker="Dopamine"
            title="Reward comes from the effort, not the ping"
            body="We deliberately avoid streaks, badges and notification dopamine. The satisfaction is designed to come from the work itself — the most durable kind."
          />
          <Principle
            kicker="Attention"
            title="Context‑switching is tax you can&rsquo;t afford"
            body="Each switch between tasks leaves residue. Zentra keeps one priority in view and hides the rest, protecting the deep work window."
          />
          <Principle
            kicker="Rhythm"
            title="90‑minute ultradian blocks"
            body="Defaults respect the brain&rsquo;s natural focus cycles: short blocks, real breaks, a closing ritual. No 8‑hour marathons."
          />
          <Principle
            kicker="Mindfulness"
            title="A breath before every block"
            body="Each Flow session opens and closes with a breath — a tiny ritual that shifts the nervous system from reactive to intentional."
          />
        </Grid>
      </Section>

      {/* ── Strategy ── */}
      <Section
        eyebrow="The strategy"
        title="Organize less. Finish more. Feel better."
      >
        <P>
          Zentra doesn&rsquo;t try to be the only place your tasks live — it tries to be the
          calmest one. The pieces work together as a single, forgiving loop:
        </P>
        <Grid>
          <Principle
            kicker="Capture"
            title="Get it out of your head"
            body="A single brain‑dump inbox. No projects, no tags to choose. Review later — never at the moment of capture."
          />
          <Principle
            kicker="Clarify"
            title="Turn noise into next actions"
            body="Zentra gently prompts for the very next physical step on each intention — the one thing that makes it truly doable."
          />
          <Principle
            kicker="Commit"
            title="Protect one priority per day"
            body="Before you touch anything else, you pick the one thing. Everything else waits in Studio until you&rsquo;re ready."
          />
          <Principle
            kicker="Close"
            title="End the day on purpose"
            body="A short ritual resets your nervous system, saves a reflection, and sends you off — so tomorrow starts fresh, not cluttered."
          />
        </Grid>
      </Section>

      {/* ── Closing CTA ── */}
      <section
        style={{
          position: 'relative',
          textAlign: 'center',
          padding: '100px 24px 140px',
          maxWidth: 640,
          margin: '0 auto',
        }}
      >
        <h2
          style={{
            fontSize: 'clamp(1.75rem, 3.5vw, 2.25rem)',
            fontWeight: 300,
            lineHeight: 1.2,
            letterSpacing: '-0.01em',
            margin: 0,
            color: 'color-mix(in srgb, var(--ink-text) 90%, transparent)',
          }}
        >
          Take a breath.
          <br />
          Then begin.
        </h2>
        <p
          style={{
            margin: '22px auto 34px',
            maxWidth: 460,
            fontSize: '1rem',
            color: 'var(--ink-text-muted)',
            lineHeight: 1.6,
          }}
        >
          Your first Flow session takes about 25 minutes. No setup required. No streaks to
          maintain. Just one honest step forward.
        </p>
        <Link
          href="/signup"
          className="z-btn z-btn-primary"
          style={{ padding: '14px 32px', fontSize: '1rem', textDecoration: 'none' }}
        >
          Begin your first flow
        </Link>
      </section>

      {/* ── Footer ── */}
      <footer
        style={{
          position: 'relative',
          borderTop: '1px solid color-mix(in srgb, var(--ink-border) 60%, transparent)',
          padding: '28px 24px',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: 'var(--ink-text-faint)',
        }}
      >
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'center' }}>
          <Sigil small />
          <span>Zentra · a calmer way to move forward</span>
        </div>
      </footer>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Small presentational helpers kept local to the page                     */
/* ─────────────────────────────────────────────────────────────────────── */

function Sigil({ small }: { small?: boolean }) {
  const size = small ? 16 : 22;
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: 999,
        background:
          'radial-gradient(circle at 35% 35%, color-mix(in srgb, var(--ink-accent) 70%, white) 0%, var(--ink-accent) 70%)',
        boxShadow: '0 0 0 1px color-mix(in srgb, var(--ink-accent) 30%, transparent)',
      }}
    />
  );
}

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      style={{
        position: 'relative',
        maxWidth: 980,
        margin: '0 auto',
        padding: '72px 24px',
      }}
    >
      <p
        style={{
          fontSize: '0.6875rem',
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--ink-text-muted)',
          marginBottom: 14,
        }}
      >
        {eyebrow}
      </p>
      <h2
        style={{
          fontSize: 'clamp(1.5rem, 3.2vw, 2.125rem)',
          fontWeight: 400,
          lineHeight: 1.2,
          letterSpacing: '-0.01em',
          margin: 0,
          color: 'color-mix(in srgb, var(--ink-text) 92%, transparent)',
          maxWidth: 720,
        }}
      >
        {title}
      </h2>
      <div style={{ marginTop: 28 }}>{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: '1.0625rem',
        lineHeight: 1.75,
        color: 'var(--ink-text-secondary, var(--ink-text))',
        maxWidth: 680,
        margin: '0 0 18px',
      }}
    >
      {children}
    </p>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 18,
        marginTop: 12,
      }}
    >
      {children}
    </div>
  );
}

function Principle({
  kicker,
  title,
  body,
}: {
  kicker: string;
  title: string;
  body: string;
}) {
  return (
    <div
      style={{
        padding: '22px 22px 20px',
        borderRadius: 14,
        border: '1px solid color-mix(in srgb, var(--ink-border) 70%, transparent)',
        background:
          'color-mix(in srgb, var(--ink-surface, var(--ink-bg)) 85%, transparent)',
      }}
    >
      <div
        style={{
          fontSize: '0.6875rem',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-accent)',
          marginBottom: 10,
          fontWeight: 500,
        }}
      >
        {kicker}
      </div>
      <h3
        style={{
          margin: 0,
          fontSize: '1.0625rem',
          fontWeight: 500,
          lineHeight: 1.35,
          color: 'color-mix(in srgb, var(--ink-text) 92%, transparent)',
        }}
      >
        {title}
      </h3>
      <p
        style={{
          margin: '10px 0 0',
          fontSize: '0.9375rem',
          lineHeight: 1.6,
          color: 'var(--ink-text-muted)',
        }}
      >
        {body}
      </p>
    </div>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return (
    <ol
      style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'grid',
        gap: 14,
      }}
    >
      {children}
    </ol>
  );
}

function Step({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}) {
  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr',
        gap: 22,
        alignItems: 'baseline',
        padding: '18px 0',
        borderTop: '1px solid color-mix(in srgb, var(--ink-border) 60%, transparent)',
      }}
    >
      <div
        style={{
          fontSize: '0.75rem',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-accent)',
          fontWeight: 500,
        }}
      >
        {n}
      </div>
      <div>
        <h3
          style={{
            margin: 0,
            fontSize: '1.125rem',
            fontWeight: 500,
            color: 'color-mix(in srgb, var(--ink-text) 92%, transparent)',
          }}
        >
          {title}
        </h3>
        <p
          style={{
            margin: '8px 0 0',
            fontSize: '0.9375rem',
            lineHeight: 1.65,
            color: 'var(--ink-text-muted)',
            maxWidth: 640,
          }}
        >
          {body}
        </p>
      </div>
    </li>
  );
}
