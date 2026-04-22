'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';

export default function OnboardingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [taskTitle, setTaskTitle] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect if already onboarded
  useEffect(() => {
    api<{ onboardingCompletedAt?: string | null }>('/auth/me')
      .then((res) => {
        if (res?.onboardingCompletedAt) {
          router.replace('/today');
        }
      })
      .catch(() => {});
  }, [router]);

  async function handleStep0() {
    const trimmed = taskTitle.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const wsRes = await api<{ workspaces: { id: string }[] }>('/workspaces');
      const workspaceId = wsRes.workspaces?.[0]?.id;
      if (!workspaceId) {
        setError('No workspace found. Please create a workspace first.');
        return;
      }

      const taskRes = await api<{ id: string; title: string }>(
        `/workspaces/${workspaceId}/tasks`,
        {
          method: 'POST',
          body: JSON.stringify({ title: trimmed, status: 'pending', priority: 'medium' }),
        },
      );

      await api('/priority/today', {
        method: 'POST',
        body: JSON.stringify({ taskId: taskRes.id }),
      });

      setTaskId(taskRes.id);
      setStep(1);
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAISuggest() {
    if (!taskId) return;
    setAiLoading(true);
    setError(null);
    try {
      const res = await api<{ nextAction: string }>('/ai/clarify', {
        method: 'POST',
        body: JSON.stringify({ taskId }),
      });
      setNextAction(res.nextAction);
    } catch {
      setError('Could not get a suggestion.');
    } finally {
      setAiLoading(false);
    }
  }

  async function handleStep1() {
    if (!taskId) return;
    setSubmitting(true);
    setError(null);
    try {
      const trimmed = nextAction.trim();
      if (trimmed) {
        await api(`/tasks/${taskId}/next-action`, {
          method: 'PATCH',
          body: JSON.stringify({ nextAction: trimmed }),
        });
      }
      setStep(2);
    } catch {
      setError('Could not save. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStartSession() {
    if (!taskId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ session: { id: string } }>('/focus/sessions', {
        method: 'POST',
        body: JSON.stringify({ taskId, plannedMinutes: 15 }),
      });

      // Mark onboarding complete
      await api('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ onboardingCompletedAt: new Date().toISOString() }),
      }).catch(() => {}); // Non-blocking

      router.push('/today');
    } catch {
      setError('Could not start. Try going to the Today view.');
      setSubmitting(false);
    }
  }

  const steps = [
    // Step 0
    <div key="s0" style={stepWrap}>
      <h1 style={headingStyle}>What's one thing you've been putting off?</h1>
      <p style={subStyle}>Something real. It doesn't have to be big.</p>
      <input
        type="text"
        value={taskTitle}
        onChange={(e) => setTaskTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleStep0()}
        placeholder="Write the report / Call mom / Clean the desk"
        autoFocus
        style={inputStyle}
      />
      {error && <p style={errorStyle}>{error}</p>}
      <button
        onClick={handleStep0}
        disabled={!taskTitle.trim() || submitting}
        style={primaryBtn(!taskTitle.trim() || submitting)}
      >
        {submitting ? '...' : "That's the one"}
      </button>
    </div>,

    // Step 1
    <div key="s1" style={stepWrap}>
      <h1 style={headingStyle}>What's the very first step?</h1>
      <p style={subStyle}>
        Something small enough to start in the next 30 seconds.
      </p>
      <input
        type="text"
        value={nextAction}
        onChange={(e) => setNextAction(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleStep1()}
        placeholder="Open the document"
        autoFocus
        style={inputStyle}
      />
      <button
        onClick={handleAISuggest}
        disabled={aiLoading}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--ink-text-muted)',
          fontSize: '0.875rem',
          cursor: aiLoading ? 'not-allowed' : 'pointer',
          padding: '0',
        }}
      >
        {aiLoading ? 'Thinking...' : 'AI suggest a first step'}
      </button>
      {error && <p style={errorStyle}>{error}</p>}
      <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
        <button onClick={() => setStep(0)} style={secondaryBtn}>Back</button>
        <button
          onClick={handleStep1}
          disabled={submitting}
          style={primaryBtn(submitting)}
        >
          {submitting ? '...' : 'Set first step'}
        </button>
      </div>
      <button
        onClick={() => setStep(2)}
        style={{ background: 'none', border: 'none', color: 'var(--ink-text-muted)', fontSize: '0.8125rem', cursor: 'pointer' }}
      >
        Skip for now
      </button>
    </div>,

    // Step 2
    <div key="s2" style={stepWrap}>
      <h1 style={headingStyle}>Press Start.</h1>
      <p style={subStyle}>
        Just 15 minutes. No pressure to finish — just start.
      </p>
      {error && <p style={errorStyle}>{error}</p>}
      <button
        onClick={handleStartSession}
        disabled={submitting}
        style={{
          width: '100%',
          padding: '18px',
          background: submitting ? 'var(--ink-text-muted)' : 'var(--ink-text)',
          border: 'none',
          borderRadius: '12px',
          color: 'var(--ink-bg)',
          fontSize: '1.125rem',
          fontWeight: 700,
          cursor: submitting ? 'not-allowed' : 'pointer',
          letterSpacing: '0.02em',
        }}
      >
        {submitting ? '...' : 'Start · 15 min'}
      </button>
    </div>,
  ];

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: 'var(--ink-bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div style={{ width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* Progress dots */}
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginBottom: '8px' }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: i === step ? 'var(--ink-text)' : 'var(--ink-border)',
              }}
            />
          ))}
        </div>
        {steps[step]}
      </div>
    </div>
  );
}

const stepWrap: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  alignItems: 'flex-start',
  width: '100%',
};

const headingStyle: React.CSSProperties = {
  fontSize: '1.375rem',
  fontWeight: 700,
  color: 'var(--ink-text)',
  margin: 0,
  lineHeight: 1.3,
};

const subStyle: React.CSSProperties = {
  fontSize: '0.9375rem',
  color: 'var(--ink-text-muted)',
  margin: 0,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px 16px',
  background: 'var(--ink-surface)',
  border: '1px solid var(--ink-border)',
  borderRadius: '10px',
  color: 'var(--ink-text)',
  fontSize: '1rem',
  outline: 'none',
  boxSizing: 'border-box',
};

const errorStyle: React.CSSProperties = {
  fontSize: '0.8125rem',
  color: 'var(--ink-text-muted)',
  margin: 0,
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    flex: 1,
    width: '100%',
    padding: '14px',
    background: disabled ? 'var(--ink-surface)' : 'var(--ink-text)',
    border: disabled ? '1px solid var(--ink-border)' : 'none',
    borderRadius: '10px',
    color: disabled ? 'var(--ink-text-muted)' : 'var(--ink-bg)',
    fontWeight: 600,
    fontSize: '0.9375rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

const secondaryBtn: React.CSSProperties = {
  padding: '14px 20px',
  background: 'var(--ink-surface)',
  border: '1px solid var(--ink-border)',
  borderRadius: '10px',
  color: 'var(--ink-text)',
  fontSize: '0.9375rem',
  cursor: 'pointer',
};
