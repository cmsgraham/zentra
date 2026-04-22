'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';

interface NextActionInputProps {
  taskId: string;
  value: string | null;
  onSave: (nextAction: string) => void;
}

export function NextActionInput({ taskId, value, onSave }: NextActionInputProps) {
  const [text, setText] = useState(value ?? '');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  async function handleAISuggest() {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await api<{ nextAction: string }>('/ai/clarify', {
        method: 'POST',
        body: JSON.stringify({ taskId }),
      });
      setText(res.nextAction);
    } catch (err: any) {
      if (err?.status === 402) {
        setAiError('Monthly limit reached. Upgrade to continue.');
      } else {
        setAiError('Could not get a suggestion right now.');
      }
    } finally {
      setAiLoading(false);
    }
  }

  function handleSave() {
    const trimmed = text.trim();
    if (trimmed) onSave(trimmed);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      <label
        style={{
          fontSize: '0.8125rem',
          color: 'var(--ink-text-muted)',
          fontWeight: 500,
        }}
      >
        What's the first step?
      </label>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          placeholder="Open the file and read the first paragraph"
          style={{
            flex: 1,
            padding: '10px 12px',
            background: 'var(--ink-surface)',
            border: '1px solid var(--ink-border)',
            borderRadius: '8px',
            color: 'var(--ink-text)',
            fontSize: '0.9375rem',
            outline: 'none',
          }}
        />
        <button
          onClick={handleAISuggest}
          disabled={aiLoading}
          title="AI suggest"
          style={{
            padding: '10px 14px',
            background: 'var(--ink-surface)',
            border: '1px solid var(--ink-border)',
            borderRadius: '8px',
            color: 'var(--ink-text-muted)',
            fontSize: '0.8125rem',
            cursor: aiLoading ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {aiLoading ? '...' : 'AI suggest'}
        </button>
      </div>
      {aiError && (
        <span style={{ fontSize: '0.75rem', color: 'var(--ink-text-muted)' }}>{aiError}</span>
      )}
      {text.trim() && (
        <button
          onClick={handleSave}
          style={{
            alignSelf: 'flex-start',
            padding: '6px 14px',
            background: 'var(--ink-accent)',
            border: 'none',
            borderRadius: '6px',
            color: '#fff',
            fontSize: '0.875rem',
            cursor: 'pointer',
          }}
        >
          Set first step
        </button>
      )}
    </div>
  );
}
