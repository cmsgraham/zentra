'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import AuthShell from '@/components/layout/AuthShell';

// Mindful, non-judgmental wording. The "pulled away by…" phrasing reframes
// distraction as a gentle noticing rather than a failure. Order goes from
// inner states → external pulls → open option.
const FEELING_CHIPS = [
  'Anxious',
  'Bored',
  'Unclear',
  'Resentful',
  'Overwhelmed',
  'Pulled away by my surroundings',
  'Pulled away by family',
  'Pulled away by my phone',
  'Pulled away by social media',
  'Something else',
];

// Short, mindful send-offs for the closing screen. One is picked at random
// so the ritual feels fresh without ever being loud or performative.
const CLOSING_PHRASES = [
  'The day is complete. You can set it down now.',
  'Nothing left to carry. Rest well.',
  'What mattered, you touched. The rest can wait.',
  'The work has a shape. Let the evening hold it.',
  'Enough for today. Breathe out.',
  'You showed up. That is the whole thing.',
  'Close the loop. Let the day close you.',
  'Tomorrow starts where you leave it — gently.',
];

interface CompletedTask {
  id: string;
  title: string;
  checked: boolean;
}

export default function ReflectPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [completedTasks, setCompletedTasks] = useState<CompletedTask[]>([]);
  const [avoidedText, setAvoidedText] = useState('');
  const [feelingText, setFeelingText] = useState('');
  const [feelingCustom, setFeelingCustom] = useState('');
  const [tomorrowText, setTomorrowText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Once the reflection is saved we transition into a quiet "closed" screen
  // with a single farewell line instead of immediately routing away. This
  // gives the day a true ending.
  const [closed, setClosed] = useState(false);
  const [closingPhrase, setClosingPhrase] = useState<string>('');

  useEffect(() => {
    Promise.all([
      api<{ items: any[]; pagination: any }>('/my/tasks?status=done&pageSize=50').catch(() => ({ items: [] })),
      api<{ reflection: any; date: string }>('/reflections/today').catch(() => ({ reflection: null, date: '' })),
    ]).then(([tasksRes, reflectionRes]) => {
      const today = new Date().toISOString().slice(0, 10);
      const todayTasks = (tasksRes as any).items?.filter((t: any) =>
        t.completedAt && t.completedAt.slice(0, 10) === today,
      ) ?? [];

      setCompletedTasks(todayTasks.map((t: any) => ({ id: t.id, title: t.title, checked: true })));

      if (reflectionRes.reflection) {
        setAvoidedText(reflectionRes.reflection.avoidedText ?? '');
        const savedFeeling = reflectionRes.reflection.feelingText ?? '';
        if (savedFeeling && !FEELING_CHIPS.includes(savedFeeling)) {
          setFeelingText('Something else');
          setFeelingCustom(savedFeeling);
        } else {
          setFeelingText(savedFeeling);
        }
        setTomorrowText(reflectionRes.reflection.tomorrowPriorityText ?? '');
      }
    }).finally(() => setLoading(false));
  }, []);

  async function handleFinish() {
    setSubmitting(true);
    setError(null);
    const finalFeeling =
      feelingText === 'Something else' ? feelingCustom.trim() : feelingText.trim();
    try {
      await api('/reflections', {
        method: 'POST',
        body: JSON.stringify({
          completedCount: completedTasks.filter((t) => t.checked).length,
          avoidedText: avoidedText.trim() || undefined,
          feelingText: finalFeeling || undefined,
          tomorrowPriorityText: tomorrowText.trim() || undefined,
        }),
      });
      setClosingPhrase(CLOSING_PHRASES[Math.floor(Math.random() * CLOSING_PHRASES.length)]);
      setClosed(true);
    } catch {
      setError('Could not save. Try again.');
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <AuthShell>
        <Shell>
          <span style={{ color: mutedText, fontSize: '0.9375rem' }}>Loading…</span>
        </Shell>
      </AuthShell>
    );
  }

  // Closing screen — the true end of the ritual. A single line, a soft
  // "goodnight", then a quiet way back to today when the user is ready.
  if (closed) {
    const tomorrow = tomorrowText.trim();
    return (
      <AuthShell>
        <Shell>
          <div
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '48px',
              maxWidth: '520px',
              width: '100%',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '18px',
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: '0.75rem',
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  color: 'color-mix(in srgb, var(--ink-text) 38%, transparent)',
                  animation: 'zentraReflectFade 900ms ease-out both',
                }}
              >
                The day is closed
              </p>
              <h1
                style={{
                  margin: 0,
                  fontSize: '1.75rem',
                  fontWeight: 400,
                  lineHeight: 1.55,
                  letterSpacing: '-0.005em',
                  color: softText,
                  maxWidth: '440px',
                  animation: 'zentraReflectFade 900ms ease-out 180ms both',
                }}
              >
                {closingPhrase}
              </h1>
            </div>

            {tomorrow && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '10px',
                  animation: 'zentraReflectFade 900ms ease-out 360ms both',
                }}
              >
                <span
                  style={{
                    fontSize: '0.6875rem',
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: 'color-mix(in srgb, var(--ink-text) 35%, transparent)',
                  }}
                >
                  Tomorrow
                </span>
                <span
                  style={{
                    fontSize: '1.0625rem',
                    lineHeight: 1.5,
                    color: 'color-mix(in srgb, var(--ink-text) 75%, transparent)',
                    maxWidth: '360px',
                  }}
                >
                  {tomorrow}
                </span>
              </div>
            )}

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '18px',
                marginTop: '12px',
                animation: 'zentraReflectFade 900ms ease-out 540ms both',
              }}
            >
              <PrimaryButton onClick={() => router.push('/today')}>
                Return when ready
              </PrimaryButton>
              <SecondaryButton onClick={() => router.push('/planner')}>
                Prepare tomorrow
              </SecondaryButton>
            </div>
          </div>
        </Shell>
      </AuthShell>
    );
  }

  const steps = [
    // Step 0 — completions
    <section key="step0" style={stepStyle}>
      <p style={questionStyle}>What did you complete today?</p>
      {completedTasks.length === 0 ? (
        <p style={hintStyle}>No completed intentions found for today.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
          {completedTasks.map((task) => {
            const active = task.checked;
            return (
              <button
                key={task.id}
                type="button"
                onClick={() =>
                  setCompletedTasks((prev) =>
                    prev.map((t) => (t.id === task.id ? { ...t, checked: !t.checked } : t)),
                  )
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  padding: '14px 16px',
                  background: active
                    ? 'color-mix(in srgb, var(--ink-accent) 10%, transparent)'
                    : 'color-mix(in srgb, var(--ink-text) 3%, transparent)',
                  border: `1px solid ${active
                    ? 'color-mix(in srgb, var(--ink-accent) 45%, transparent)'
                    : 'color-mix(in srgb, var(--ink-text) 10%, transparent)'}`,
                  borderRadius: '14px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 200ms ease, border-color 200ms ease',
                  font: 'inherit',
                  color: 'inherit',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    border: `1.5px solid ${active
                      ? 'color-mix(in srgb, var(--ink-accent) 70%, transparent)'
                      : 'color-mix(in srgb, var(--ink-text) 25%, transparent)'}`,
                    background: active
                      ? 'color-mix(in srgb, var(--ink-accent) 60%, transparent)'
                      : 'transparent',
                    flexShrink: 0,
                    transition: 'all 200ms ease',
                  }}
                />
                <span style={{ fontSize: '0.9375rem', color: softText, lineHeight: 1.4 }}>
                  {task.title}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <NavRow>
        <PrimaryButton onClick={() => setStep(1)}>Continue</PrimaryButton>
      </NavRow>
    </section>,

    // Step 1 — what did you avoid
    <section key="step1" style={stepStyle}>
      <p style={questionStyle}>What did you avoid?</p>
      <p style={hintStyle}>No judgment. Just noticing.</p>
      <textarea
        value={avoidedText}
        onChange={(e) => setAvoidedText(e.target.value)}
        placeholder="Optional — just for you"
        rows={4}
        style={textareaStyle}
      />
      <NavRow>
        <SecondaryButton onClick={() => setStep(0)}>Back</SecondaryButton>
        <PrimaryButton onClick={() => setStep(2)}>Continue</PrimaryButton>
      </NavRow>
    </section>,

    // Step 2 — feelings
    <section key="step2" style={stepStyle}>
      <p style={questionStyle}>What were you feeling?</p>
      <p style={hintStyle}>Pick the one that lands. There's no wrong answer.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', width: '100%' }}>
        {FEELING_CHIPS.map((chip) => {
          const active = feelingText === chip;
          return (
            <button
              key={chip}
              type="button"
              onClick={() => setFeelingText(active ? '' : chip)}
              style={{
                padding: '9px 16px',
                borderRadius: '999px',
                border: `1px solid ${active
                  ? 'color-mix(in srgb, var(--ink-accent) 55%, transparent)'
                  : 'color-mix(in srgb, var(--ink-text) 12%, transparent)'}`,
                background: active
                  ? 'color-mix(in srgb, var(--ink-accent) 15%, transparent)'
                  : 'color-mix(in srgb, var(--ink-text) 3%, transparent)',
                color: active ? softText : mutedText,
                fontSize: '0.875rem',
                letterSpacing: '0.01em',
                cursor: 'pointer',
                transition: 'all 200ms ease',
                font: 'inherit',
              }}
            >
              {chip}
            </button>
          );
        })}
      </div>
      {feelingText === 'Something else' && (
        <input
          type="text"
          value={feelingCustom}
          onChange={(e) => setFeelingCustom(e.target.value)}
          placeholder="Name it gently…"
          style={inputStyle}
          autoFocus
        />
      )}
      <NavRow>
        <SecondaryButton onClick={() => setStep(1)}>Back</SecondaryButton>
        <PrimaryButton onClick={() => setStep(3)}>Continue</PrimaryButton>
      </NavRow>
    </section>,

    // Step 3 — tomorrow
    <section key="step3" style={stepStyle}>
      <p style={questionStyle}>What's the one thing for tomorrow?</p>
      <p style={hintStyle}>Keep it small. Keep it true.</p>
      <input
        type="text"
        value={tomorrowText}
        onChange={(e) => setTomorrowText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleFinish()}
        placeholder="The most important thing"
        style={inputStyle}
        autoFocus
      />
      {error && (
        <p style={{ ...hintStyle, color: 'color-mix(in srgb, var(--ink-blocked) 80%, transparent)' }}>
          {error}
        </p>
      )}
      <NavRow>
        <SecondaryButton onClick={() => setStep(2)}>Back</SecondaryButton>
        <PrimaryButton onClick={handleFinish} disabled={submitting}>
          {submitting ? 'Saving…' : 'Close the day'}
        </PrimaryButton>
      </NavRow>
    </section>,
  ];

  return (
    <AuthShell>
      <Shell>
        <div
          style={{
            width: '100%',
            maxWidth: '480px',
            display: 'flex',
            flexDirection: 'column',
            gap: '36px',
          }}
        >
          {/* Kicker */}
          <div
            style={{
              textAlign: 'center',
              animation: 'zentraReflectFade 900ms ease-out both',
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: '0.75rem',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'color-mix(in srgb, var(--ink-text) 40%, transparent)',
              }}
            >
              Reflect & close today
            </p>
          </div>

          {/* Progress — soft dots, no hard bars */}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'center' }}>
            {[0, 1, 2, 3].map((i) => {
              const done = i < step;
              const current = i === step;
              return (
                <span
                  key={i}
                  aria-hidden
                  style={{
                    width: current ? '24px' : '6px',
                    height: '6px',
                    borderRadius: '999px',
                    background: done
                      ? 'color-mix(in srgb, var(--ink-accent) 55%, transparent)'
                      : current
                        ? 'color-mix(in srgb, var(--ink-accent) 80%, transparent)'
                        : 'color-mix(in srgb, var(--ink-text) 15%, transparent)',
                    transition: 'all 320ms ease',
                  }}
                />
              );
            })}
          </div>

          <div key={step} style={{ animation: 'zentraReflectFade 600ms ease-out both' }}>
            {steps[step]}
          </div>
        </div>
      </Shell>
    </AuthShell>
  );
}

// Shared visual shell — mirrors the Completion Ritual aesthetic: floating
// content on a warm, softly breathing backdrop with no harsh contrast.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100%',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '56px 24px',
        overflow: 'hidden',
        background:
          'radial-gradient(ellipse at 50% 35%, color-mix(in srgb, var(--ink-accent) 7%, transparent) 0%, transparent 60%), var(--ink-bg-soft, var(--ink-bg))',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--ink-accent) 9%, transparent) 0%, transparent 55%)',
          animation: 'zentraReflectBreath 8s ease-in-out infinite',
          opacity: 0.55,
        }}
      />
      <style>{`
        @keyframes zentraReflectBreath {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50%      { opacity: 0.65; transform: scale(1.035); }
        }
        @keyframes zentraReflectFade {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.001ms !important; }
        }
      `}</style>
      <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
        {children}
      </div>
    </div>
  );
}

function NavRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '12px',
        width: '100%',
        marginTop: '12px',
        justifyContent: 'flex-end',
        alignItems: 'center',
      }}
    >
      {children}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        appearance: 'none',
        minWidth: '160px',
        padding: '14px 28px',
        background: 'color-mix(in srgb, var(--ink-text) 86%, var(--ink-bg))',
        color: 'var(--ink-bg)',
        border: 'none',
        borderRadius: '999px',
        fontSize: '0.9375rem',
        fontWeight: 500,
        letterSpacing: '0.01em',
        cursor: disabled ? 'default' : 'pointer',
        boxShadow:
          '0 1px 2px color-mix(in srgb, var(--ink-text) 10%, transparent), 0 12px 30px -12px color-mix(in srgb, var(--ink-text) 25%, transparent)',
        transition: 'transform 260ms ease, box-shadow 260ms ease',
        opacity: disabled ? 0.7 : 1,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.transform = 'scale(1.02)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        appearance: 'none',
        padding: '14px 20px',
        background: 'transparent',
        color: 'color-mix(in srgb, var(--ink-text) 55%, transparent)',
        border: 'none',
        borderRadius: '999px',
        fontSize: '0.9375rem',
        letterSpacing: '0.01em',
        cursor: 'pointer',
        opacity: 0.8,
        transition: 'opacity 240ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.8'; }}
    >
      {children}
    </button>
  );
}

// ── Shared tokens ─────────────────────────────────────────────────────────
const softText = 'color-mix(in srgb, var(--ink-text) 88%, transparent)';
const mutedText = 'color-mix(in srgb, var(--ink-text) 50%, transparent)';

const stepStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '18px',
  width: '100%',
  alignItems: 'flex-start',
};

const questionStyle: CSSProperties = {
  fontSize: '1.375rem',
  fontWeight: 400,
  lineHeight: 1.5,
  letterSpacing: '-0.005em',
  color: softText,
  margin: 0,
};

const hintStyle: CSSProperties = {
  margin: 0,
  fontSize: '0.875rem',
  lineHeight: 1.5,
  color: mutedText,
  letterSpacing: '0.01em',
};

const textareaStyle: CSSProperties = {
  width: '100%',
  padding: '14px 16px',
  background: 'color-mix(in srgb, var(--ink-text) 3%, transparent)',
  border: '1px solid color-mix(in srgb, var(--ink-text) 10%, transparent)',
  borderRadius: '14px',
  color: softText,
  fontSize: '0.9375rem',
  lineHeight: 1.55,
  outline: 'none',
  resize: 'vertical',
  boxSizing: 'border-box',
  font: 'inherit',
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '14px 16px',
  background: 'color-mix(in srgb, var(--ink-text) 3%, transparent)',
  border: '1px solid color-mix(in srgb, var(--ink-text) 10%, transparent)',
  borderRadius: '14px',
  color: softText,
  fontSize: '0.9375rem',
  outline: 'none',
  boxSizing: 'border-box',
  font: 'inherit',
};
