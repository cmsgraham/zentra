'use client';

import { memo, useRef, useState } from 'react';

interface Props {
  onSubmit: (title: string) => Promise<void>;
  placeholder?: string;
}

/**
 * Uncontrolled quick-add input. The `<input>` element owns its own value —
 * React never re-renders this component while typing or on Enter, so the
 * DOM node (and its focus) stays completely untouched. Rapid-entry flow:
 *
 *   type → Enter → clear value via `input.value = ''` → fire onSubmit
 *   (parent may re-render its list; irrelevant — this component is memo'd
 *   and receives no new props) → keep typing immediately.
 *
 * We don't call `.focus()` anywhere in the happy path because focus never
 * leaves the input. `busy` is a ref, not state, to avoid re-rendering.
 */
function QuickAddInputInner({ onSubmit, placeholder = '+ Add intention…' }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <input
        ref={inputRef}
        defaultValue=""
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || busyRef.current) return;
          const el = inputRef.current;
          if (!el) return;
          const trimmed = el.value.trim();
          if (!trimmed) return;
          e.preventDefault();
          // Clear directly in the DOM — no React state, no re-render.
          el.value = '';
          busyRef.current = true;
          if (error) setError(null);
          void onSubmit(trimmed)
            .catch((err: unknown) => {
              // Restore the draft into the DOM so the user doesn't lose it.
              if (inputRef.current) inputRef.current.value = trimmed;
              setError(err instanceof Error ? err.message : 'Failed to add');
            })
            .finally(() => {
              busyRef.current = false;
            });
        }}
        placeholder={placeholder}
        className="w-full text-xs bg-transparent outline-none px-2.5 py-2 rounded-lg"
        style={{ color: 'var(--ink-text)', border: '1px dashed var(--ink-border-subtle)' }}
        autoComplete="off"
        spellCheck={false}
      />
      {error && (
        <div className="text-[10px] mt-1 px-1" style={{ color: 'var(--ink-blocked, #ef4444)' }}>
          {error}
        </div>
      )}
    </div>
  );
}

const QuickAddInput = memo(QuickAddInputInner);
export default QuickAddInput;

