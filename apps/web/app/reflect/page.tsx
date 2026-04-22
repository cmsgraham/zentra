'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import AuthShell from '@/components/layout/AuthShell';

const FEELING_CHIPS = ['Anxious', 'Bored', 'Unclear', 'Resentful', 'Overwhelmed', 'Something else'];

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
  const [tomorrowText, setTomorrowText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load today's completed tasks and any existing reflection
    Promise.all([
      api<{ items: any[]; pagination: any }>('/my/tasks?status=done&pageSize=50').catch(() => ({ items: [] })),
      api<{ reflection: any; date: string }>('/reflections/today').catch(() => ({ reflection: null, date: '' })),
    ]).then(([tasksRes, reflectionRes]) => {
      // Filter tasks completed today (rough check via completedAt)
      const today = new Date().toISOString().slice(0, 10);
      const todayTasks = (tasksRes as any).items?.filter((t: any) =>
        t.completedAt && t.completedAt.slice(0, 10) === today,
      ) ?? [];

      setCompletedTasks(todayTasks.map((t: any) => ({ id: t.id, title: t.title, checked: true })));

      if (reflectionRes.reflection) {
        setAvoidedText(reflectionRes.reflection.avoidedText ?? '');
        setFeelingText(reflectionRes.reflection.feelingText ?? '');
        setTomorrowText(reflectionRes.reflection.tomorrowPriorityText ?? '');
      }
    }).finally(() => setLoading(false));
  }, []);

  async function handleFinish() {
    setSubmitting(true);
    setError(null);
    try {
      await api('/reflections', {
        method: 'POST',
        body: JSON.stringify({
          completedCount: completedTasks.filter((t) => t.checked).length,
          avoidedText: avoidedText.trim() || undefined,
          feelingText: feelingText.trim() || undefined,
          tomorrowPriorityText: tomorrowText.trim() || undefined,
        }),
      });
      router.push('/today');
    } catch {
      setError('Could not save. Try again.');
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <AuthShell>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
          <span style={{ color: 'var(--ink-text-muted)' }}>Loading...</span>
        </div>
      </AuthShell>
    );
  }

  const steps = [
    // Step 0: What did you complete?
    <div key="step0" style={stepStyle}>
      <p style={questionStyle}>What did you complete today?</p>
      {completedTasks.length === 0 ? (
        <p style={{ color: 'var(--ink-text-muted)', fontSize: '0.9375rem' }}>
          No completed intentions found for today.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
          {completedTasks.map((task) => (
            <button
              key={task.id}
              onClick={() =>
                setCompletedTasks((prev) =>
                  prev.map((t) => (t.id === task.id ? { ...t, checked: !t.checked } : t)),
                )
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 14px',
                background: task.checked ? 'var(--ink-surface)' : 'var(--ink-bg)',
                border: `1px solid ${task.checked ? 'var(--ink-accent)' : 'var(--ink-border)'}`,
                borderRadius: '10px',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '4px',
                  border: `2px solid ${task.checked ? 'var(--ink-accent)' : 'var(--ink-border)'}`,
                  background: task.checked ? 'var(--ink-accent)' : 'transparent',
                  flexShrink: 0,
                }}
              />
              <span style={{ color: 'var(--ink-text)', fontSize: '0.9375rem' }}>{task.title}</span>
            </button>
          ))}
        </div>
      )}
      <button onClick={() => setStep(1)} style={primaryBtn}>Next</button>
    </div>,

    // Step 1: What did you avoid?
    <div key="step1" style={stepStyle}>
      <p style={questionStyle}>What did you avoid?</p>
      <textarea
        value={avoidedText}
        onChange={(e) => setAvoidedText(e.target.value)}
        placeholder="Optional — just for you"
        rows={4}
        style={textareaStyle}
      />
      <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
        <button onClick={() => setStep(0)} style={secondaryBtn}>Back</button>
        <button onClick={() => setStep(2)} style={primaryBtn}>Next</button>
      </div>
    </div>,

    // Step 2: How were you feeling?
    <div key="step2" style={stepStyle}>
      <p style={questionStyle}>What were you feeling?</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', width: '100%' }}>
        {FEELING_CHIPS.map((chip) => {
          const active = feelingText === chip;
          return (
            <button
              key={chip}
              onClick={() => setFeelingText(active ? '' : chip)}
              style={{
                padding: '8px 14px',
                borderRadius: '999px',
                border: `1px solid ${active ? 'var(--ink-accent)' : 'var(--ink-border)'}`,
                background: active ? 'var(--ink-accent)' : 'var(--ink-surface)',
                color: active ? '#fff' : 'var(--ink-text)',
                fontSize: '0.875rem',
                cursor: 'pointer',
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
          value={feelingText === 'Something else' ? '' : feelingText}
          onChange={(e) => setFeelingText(e.target.value)}
          placeholder="Describe it..."
          style={inputStyle}
        />
      )}
      <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
        <button onClick={() => setStep(1)} style={secondaryBtn}>Back</button>
        <button onClick={() => setStep(3)} style={primaryBtn}>Next</button>
      </div>
    </div>,

    // Step 3: What's tomorrow's one thing?
    <div key="step3" style={stepStyle}>
      <p style={questionStyle}>What's the one thing for tomorrow?</p>
      <input
        type="text"
        value={tomorrowText}
        onChange={(e) => setTomorrowText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleFinish()}
        placeholder="The most important thing"
        style={inputStyle}
        autoFocus
      />
      {error && <p style={{ color: 'var(--ink-text-muted)', fontSize: '0.8125rem' }}>{error}</p>}
      <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
        <button onClick={() => setStep(2)} style={secondaryBtn}>Back</button>
        <button onClick={handleFinish} disabled={submitting} style={primaryBtn}>
          {submitting ? 'Saving...' : 'Done'}
        </button>
      </div>
    </div>,
  ];

  return (
    <AuthShell>
      <div
        style={{
          maxWidth: '400px',
          margin: '0 auto',
          padding: '40px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        {/* Progress */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: '3px',
                borderRadius: '2px',
                background: i <= step ? 'var(--ink-accent)' : 'var(--ink-border)',
              }}
            />
          ))}
        </div>

        {steps[step]}
      </div>
    </AuthShell>
  );
}

const stepStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  width: '100%',
  alignItems: 'flex-start',
};

const questionStyle: React.CSSProperties = {
  fontSize: '1.1875rem',
  fontWeight: 600,
  color: 'var(--ink-text)',
  margin: 0,
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  background: 'var(--ink-surface)',
  border: '1px solid var(--ink-border)',
  borderRadius: '10px',
  color: 'var(--ink-text)',
  fontSize: '0.9375rem',
  outline: 'none',
  resize: 'vertical',
  boxSizing: 'border-box',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  background: 'var(--ink-surface)',
  border: '1px solid var(--ink-border)',
  borderRadius: '10px',
  color: 'var(--ink-text)',
  fontSize: '0.9375rem',
  outline: 'none',
  boxSizing: 'border-box',
};

const primaryBtn: React.CSSProperties = {
  flex: 1,
  padding: '14px',
  background: 'var(--ink-text)',
  border: 'none',
  borderRadius: '10px',
  color: 'var(--ink-bg)',
  fontWeight: 600,
  fontSize: '0.9375rem',
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  padding: '14px 20px',
  background: 'var(--ink-surface)',
  border: '1px solid var(--ink-border)',
  borderRadius: '10px',
  color: 'var(--ink-text)',
  fontSize: '0.9375rem',
  cursor: 'pointer',
};
