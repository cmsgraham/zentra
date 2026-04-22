'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';

interface EmptyPriorityPromptProps {
  suggestedTitle?: string | null;
  onPrioritySet: (task: any) => void;
}

interface OpenTask {
  id: string;
  title: string;
  status: string;
  workspaceName?: string;
  dueDate?: string | null;
}

export function EmptyPriorityPrompt({ suggestedTitle, onPrioritySet }: EmptyPriorityPromptProps) {
  const router = useRouter();
  const [title, setTitle] = useState(suggestedTitle ?? '');
  const [loading, setLoading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsWorkspace, setNeedsWorkspace] = useState(false);
  const [openTasks, setOpenTasks] = useState<OpenTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ items: any[] }>('/my/tasks?pageSize=100');
        if (cancelled) return;
        const items: OpenTask[] = (res.items || [])
          .filter((t: any) => t.status !== 'done')
          .map((t: any) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            workspaceName: t.workspaceName,
            dueDate: t.dueDate ?? null,
          }));
        setOpenTasks(items);
      } catch {
        // ignore — dropdown just won't show
      } finally {
        if (!cancelled) setTasksLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handlePickExisting(taskId: string) {
    if (!taskId) return;
    const picked = openTasks.find((t) => t.id === taskId);
    if (!picked) return;
    setPicking(true);
    setError(null);
    try {
      await api('/priority/today', {
        method: 'POST',
        body: JSON.stringify({ taskId }),
      });
      onPrioritySet({
        id: picked.id,
        title: picked.title,
        nextAction: null,
        nextActionState: 'unclear',
      });
    } catch {
      setError("Could not set that as today's priority.");
    } finally {
      setPicking(false);
    }
  }

  async function handleSuggest() {
    setSuggesting(true);
    setError(null);
    try {
      const res = await api<{ task: any }>('/priority/suggest', { method: 'POST' });
      if (res.task?.title) {
        setTitle(res.task.title);
      } else {
        setError("No suggestion found. What's one thing you need to do today?");
      }
    } catch {
      setError('Could not load a suggestion.');
    } finally {
      setSuggesting(false);
    }
  }

  async function handleSubmit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      // We need to know the user's default workspace to create a task
      // Get first available workspace
      const wsRes = await api<{ items: { id: string }[] }>('/workspaces');
      const workspaceId = wsRes.items?.[0]?.id;
      if (!workspaceId) {
        setError('No space found. Create one first.');
        setNeedsWorkspace(true);
        return;
      }

      // Create task
      const taskRes = await api<any>(`/workspaces/${workspaceId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ title: trimmed, status: 'pending', priority: 'medium' }),
      });

      // Set as today's priority
      await api('/priority/today', {
        method: 'POST',
        body: JSON.stringify({ taskId: taskRes.id }),
      });

      onPrioritySet(taskRes);
    } catch (err: any) {
      setError('Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '20px',
        padding: '60px 24px',
        maxWidth: '400px',
        margin: '0 auto',
        width: '100%',
      }}
    >
      <p
        style={{
          fontSize: '1.25rem',
          fontWeight: 600,
          color: 'var(--ink-text)',
          textAlign: 'center',
          margin: 0,
        }}
      >
        What's the one thing today?
      </p>

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        placeholder="Write the first draft of the report"
        autoFocus
        style={{
          width: '100%',
          padding: '14px 16px',
          background: 'var(--ink-surface)',
          border: '1px solid var(--ink-border)',
          borderRadius: '10px',
          color: 'var(--ink-text)',
          fontSize: '1rem',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />

      {error && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--ink-text-muted)', margin: 0 }}>{error}</p>
      )}

      {needsWorkspace && (
        <button
          onClick={() => router.push('/workspaces')}
          style={{
            width: '100%',
            padding: '12px',
            background: 'var(--ink-surface)',
            border: '1px solid var(--ink-border)',
            borderRadius: '10px',
            color: 'var(--ink-text)',
            fontSize: '0.9375rem',
            cursor: 'pointer',
          }}
        >
          Go to Workspaces
        </button>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading || !title.trim()}
        style={{
          width: '100%',
          padding: '14px',
          background: title.trim() ? 'var(--ink-text)' : 'var(--ink-surface)',
          border: title.trim() ? 'none' : '1px solid var(--ink-border)',
          borderRadius: '10px',
          color: title.trim() ? 'var(--ink-bg)' : 'var(--ink-text-muted)',
          fontSize: '1rem',
          fontWeight: 600,
          cursor: loading || !title.trim() ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? 'Setting...' : "Set as today's priority"}
      </button>

      {/* Pick from existing open tasks */}
      {!tasksLoading && openTasks.length > 0 && (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              color: 'var(--ink-text-muted)',
              fontSize: '0.75rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            <div style={{ flex: 1, height: '1px', background: 'var(--ink-border)' }} />
            <span>or pick from your open intentions</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--ink-border)' }} />
          </div>

          <select
            defaultValue=""
            disabled={picking}
            onChange={(e) => handlePickExisting(e.target.value)}
            style={{
              width: '100%',
              padding: '14px 16px',
              background: 'var(--ink-surface)',
              border: '1px solid var(--ink-border)',
              borderRadius: '10px',
              color: 'var(--ink-text)',
              fontSize: '0.9375rem',
              outline: 'none',
              boxSizing: 'border-box',
              cursor: picking ? 'not-allowed' : 'pointer',
              appearance: 'none',
              backgroundImage:
                "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path fill='%23888' d='M6 8L2 4h8z'/></svg>\")",
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 14px center',
              paddingRight: '40px',
            }}
          >
            <option value="" disabled>
              {picking
                ? 'Setting…'
                : `Choose one of ${openTasks.length} open intention${openTasks.length === 1 ? '' : 's'}…`}
            </option>
            {openTasks.map((t) => {
              const due = t.dueDate ? ` · due ${String(t.dueDate).slice(0, 10)}` : '';
              const ws = t.workspaceName ? ` [${t.workspaceName}]` : '';
              return (
                <option key={t.id} value={t.id}>
                  {t.title}{due}{ws}
                </option>
              );
            })}
          </select>
        </>
      )}

      <button
        onClick={handleSuggest}
        disabled={suggesting}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--ink-text-muted)',
          fontSize: '0.875rem',
          cursor: suggesting ? 'not-allowed' : 'pointer',
        }}
      >
        {suggesting ? 'Looking...' : 'Suggest from yesterday'}
      </button>
    </div>
  );
}
