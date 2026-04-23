'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';

interface SuggestedTask {
  id: string;
  title: string;
  nextAction?: string | null;
  nextActionState?: 'unclear' | 'set' | 'done';
}

interface CompleteDayViewProps {
  completedCount: number;
  totalMinutes: number;
  onAddAnother: () => void;
  onStartSuggested?: (task: SuggestedTask) => void;
  /** User's configured end-of-day time in `HH:MM`. Used to decide whether the
   *  "Plan tomorrow" nudge is shown (only during the final 2 hours). */
  endOfDayTime?: string;
}

// Gentle, varied headlines for the completion ritual. A new one surfaces
// roughly every 2 days — enough for the screen to feel fresh without losing
// the sense of a familiar ritual. Each string is rendered as HTML so we can
// break with <br /> where it feels most natural.
const RITUAL_HEADLINES: string[] = [
  'That was the one thing.<br />Nice work.',
  'One true thing,<br />done today.',
  'You showed up.<br />That counts.',
  'The day held something real.<br />Rest into that.',
  'Steady hands,<br />honest work.',
  'You kept your word<br />to yourself.',
  'Progress, quietly made.<br />Enough for today.',
  'A small stone laid<br />in a long path.',
  'Done is a kind of peace.<br />Let it settle.',
  'Today answered<br />to you.',
  'You chose, and you finished.<br />Well met.',
  'One focused hour<br />outweighs a scattered day.',
  'The work is alive<br />because you tended it.',
  'Gentle on yourself —<br />you moved the thing forward.',
  'Your attention became<br />something real today.',
  'The momentum is yours.<br />Carry it softly.',
  'You chose depth<br />over noise.',
  'A good day<br />for the work that matters.',
  'The important thing<br />got your best hours.',
  'You ended the loop.<br />Let tomorrow begin fresh.',
  'Quiet victory —<br />the kind that lasts.',
  'You were here,<br />fully, for a while.',
];

function pickHeadline(): string {
  // Rotate every ~2 days. Uses days since Unix epoch so the index is stable
  // across reloads within the same window. A mild user-specific offset is
  // added later (in the component) if a token is available; for now the
  // date-based rotation alone is enough variety for a single user.
  const dayIndex = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  const slot = Math.floor(dayIndex / 2);
  return RITUAL_HEADLINES[slot % RITUAL_HEADLINES.length];
}

export function CompleteDayView({ completedCount, totalMinutes, onAddAnother, onStartSuggested, endOfDayTime }: CompleteDayViewProps) {
  const router = useRouter();
  const [nextTitle, setNextTitle] = useState<string | null>(null);
  const [nextTask, setNextTask] = useState<SuggestedTask | null>(null);
  const [priming, setPriming] = useState(false);
  // Whether the user has already closed today with a reflection. When true
  // we hide "Reflect and close today" so the screen doesn't ask them to do
  // something they've already done. Resets naturally on the next calendar
  // day because /reflections/today is date-scoped server-side.
  const [alreadyReflected, setAlreadyReflected] = useState(false);
  // Mindfulness nudge surfaces only sometimes (~35% of completions) so it
  // remains a gentle surprise rather than routine UI.
  const [showBreath] = useState(() => Math.random() < 0.35);
  // Rotating ritual headline. Stable for the lifetime of the component so
  // it doesn't flicker between renders.
  const [rotatingHeadline] = useState(() => pickHeadline());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{
          suggestion: SuggestedTask | null;
          suggestionText?: string | null;
        }>('/priority/suggest', { method: 'POST' });
        if (cancelled) return;
        setNextTask(res.suggestion ?? null);
        const title = res.suggestion?.title ?? res.suggestionText ?? null;
        setNextTitle(title);
      } catch {
        if (!cancelled) {
          setNextTask(null);
          setNextTitle(null);
        }
      }
    })();
    // Independent: has today's reflection been saved?
    (async () => {
      try {
        const res = await api<{ reflection: unknown | null }>('/reflections/today');
        if (!cancelled) setAlreadyReflected(Boolean(res.reflection));
      } catch {
        if (!cancelled) setAlreadyReflected(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleNextUpClick() {
    if (priming) return;
    if (nextTask?.id && onStartSuggested) {
      setPriming(true);
      try {
        await api('/priority/today', {
          method: 'POST',
          body: JSON.stringify({ taskId: nextTask.id }),
        });
        onStartSuggested({
          id: nextTask.id,
          title: nextTask.title,
          nextAction: nextTask.nextAction ?? null,
          nextActionState: nextTask.nextActionState ?? 'unclear',
        });
      } catch {
        // Fall back to the chooser if priming failed
        onAddAnother();
      } finally {
        setPriming(false);
      }
      return;
    }
    onAddAnother();
  }

  // Detect whether we're inside the detached mini-working popup. When so,
  // navigate the opener window and close this one instead of routing in-place.
  const navigate = (path: string) => {
    if (typeof window !== 'undefined' && window.opener && !window.opener.closed) {
      try {
        window.opener.location.href = path;
        window.opener.focus();
      } catch { /* cross-origin guard */ }
      window.close();
      return;
    }
    router.push(path);
  };

  // "Prepare tomorrow" surfaces starting 2 hours before the user's configured
  // end-of-day and stays visible through the end of the day (and a bit past,
  // so late-running rituals don't lose the action).
  const showPlanTomorrow = (() => {
    if (!endOfDayTime) return true;
    const match = /^(\d{2}):(\d{2})/.exec(endOfDayTime);
    if (!match) return true;
    const endHours = Number(match[1]);
    const endMinutes = Number(match[2]);
    const now = new Date();
    const endToday = new Date(now);
    endToday.setHours(endHours, endMinutes, 0, 0);
    const diffMs = endToday.getTime() - now.getTime();
    // Visible from 2h before end-of-day onward (including after end-of-day).
    return diffMs <= 2 * 60 * 60 * 1000;
  })();

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100%',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '64px 24px',
        overflow: 'hidden',
        // Warm off-white in light mode, deep blue-gray charcoal in dark. We
        // layer a very slow breathing radial glow on top for ambience.
        background:
          'radial-gradient(ellipse at 50% 40%, color-mix(in srgb, var(--ink-accent) 8%, transparent) 0%, transparent 65%), var(--ink-bg-soft, var(--ink-bg))',
      }}
    >
      {/* Ambient breathing glow — extremely subtle, ~7s pulse. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--ink-accent) 10%, transparent) 0%, transparent 55%)',
          animation: 'zentraBreath 7s ease-in-out infinite',
          opacity: 0.6,
        }}
      />

      <style>{`
        @keyframes zentraBreath {
          0%, 100% { opacity: 0.35; transform: scale(1); }
          50%      { opacity: 0.7;  transform: scale(1.04); }
        }
        @keyframes zentraFadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .zentra-ritual-breath { animation: none !important; }
          .zentra-ritual-in { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
      `}</style>

      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '56px',
          textAlign: 'center',
          maxWidth: '460px',
          width: '100%',
        }}
      >
        {/* Headline — rotates every ~2 days so the ritual stays fresh. */}
        <h1
          className="zentra-ritual-in"
          style={{
            margin: 0,
            fontSize: '1.875rem',
            fontWeight: 400,
            lineHeight: 1.5,
            letterSpacing: '-0.005em',
            color: 'color-mix(in srgb, var(--ink-text) 88%, transparent)',
            animation: 'zentraFadeUp 900ms ease-out both',
          }}
          dangerouslySetInnerHTML={{ __html: rotatingHeadline }}
        />

        {/* Stats — fades in shortly after the title. */}
        <div
          className="zentra-ritual-in"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '14px',
            animation: 'zentraFadeUp 900ms ease-out 180ms both',
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '0.9375rem',
              lineHeight: 1.6,
              letterSpacing: '0.01em',
              color: 'color-mix(in srgb, var(--ink-text) 55%, transparent)',
            }}
          >
            {completedCount} {completedCount === 1 ? 'session' : 'sessions'} · {totalMinutes} minutes focused
          </p>
          {showBreath && (
            <p
              style={{
                margin: 0,
                fontSize: '0.8125rem',
                fontStyle: 'italic',
                letterSpacing: '0.02em',
                color: 'color-mix(in srgb, var(--ink-text) 35%, transparent)',
              }}
            >
              Take a breath.
            </p>
          )}
        </div>

        {/* Primary CTA */}
        <button
          type="button"
          onClick={handleNextUpClick}
          disabled={priming}
          aria-label={nextTitle ? `Start next task: ${nextTitle}` : 'Start next task'}
          className="zentra-ritual-in"
          style={{
            appearance: 'none',
            minWidth: '220px',
            padding: '16px 36px',
            background: 'var(--ink-accent)',
            color: 'var(--ink-on-accent)',
            border: 'none',
            borderRadius: '999px',
            fontSize: '0.9375rem',
            fontWeight: 500,
            letterSpacing: '0.01em',
            cursor: priming ? 'default' : 'pointer',
            boxShadow:
              '0 1px 2px color-mix(in srgb, var(--ink-accent) 20%, transparent), 0 12px 32px -12px color-mix(in srgb, var(--ink-accent) 45%, transparent)',
            transition: 'transform 260ms ease, box-shadow 260ms ease, background 260ms ease',
            animation: 'zentraFadeUp 900ms ease-out 360ms both',
          }}
          onMouseEnter={(e) => {
            if (priming) return;
            e.currentTarget.style.transform = 'scale(1.02)';
            e.currentTarget.style.background = 'var(--ink-accent-hover)';
            e.currentTarget.style.boxShadow =
              '0 2px 4px color-mix(in srgb, var(--ink-accent) 25%, transparent), 0 18px 40px -14px color-mix(in srgb, var(--ink-accent) 55%, transparent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.background = 'var(--ink-accent)';
            e.currentTarget.style.boxShadow =
              '0 1px 2px color-mix(in srgb, var(--ink-accent) 20%, transparent), 0 12px 32px -12px color-mix(in srgb, var(--ink-accent) 45%, transparent)';
          }}
          onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.99)'; }}
          onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1.02)'; }}
        >
          Start next task
        </button>

        {/* Secondary actions — optional, reduced weight, generous spacing. */}
        <div
          className="zentra-ritual-in"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '22px',
            marginTop: '4px',
            animation: 'zentraFadeUp 900ms ease-out 540ms both',
          }}
        >
          {showPlanTomorrow && (
            <button
              type="button"
              onClick={() => {
                const t = new Date();
                t.setDate(t.getDate() + 1);
                const y = t.getFullYear();
                const m = String(t.getMonth() + 1).padStart(2, '0');
                const d = String(t.getDate()).padStart(2, '0');
                navigate(`/planner?date=${y}-${m}-${d}`);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '6px 10px',
                fontSize: '0.875rem',
                letterSpacing: '0.01em',
                color: 'color-mix(in srgb, var(--ink-text) 50%, transparent)',
                cursor: 'pointer',
                opacity: 0.75,
                transition: 'opacity 240ms ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.75'; }}
            >
              Prepare tomorrow (2 min)
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate('/reflect')}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '6px 10px',
              fontSize: '0.875rem',
              letterSpacing: '0.01em',
              color: 'color-mix(in srgb, var(--ink-text) 50%, transparent)',
              cursor: 'pointer',
              opacity: 0.75,
              transition: 'opacity 240ms ease',
              display: alreadyReflected ? 'none' : undefined,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.75'; }}
          >
            Reflect and close today
          </button>
        </div>
      </div>
    </div>
  );
}
