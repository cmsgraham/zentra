'use client';

/**
 * TourLegend
 *
 * "What is this?" mode. When enabled, hovering any region tagged with
 * `data-tour-label="..."` shows a tiny floating chip that names the section.
 * Lets returning users re-explore the layout without restarting the full
 * walkthrough. Toggle from Help/Settings (or with `useTour().setLegend`).
 */

import { useEffect, useState } from 'react';
import { useTour } from '@/lib/useTour';

interface Hover { x: number; y: number; label: string; }

export default function TourLegend() {
  const legendMode = useTour((s) => s.legendMode);
  const setLegend = useTour((s) => s.setLegend);
  const [hover, setHover] = useState<Hover | null>(null);

  useEffect(() => {
    if (!legendMode) { setHover(null); return; }

    function onMove(e: MouseEvent) {
      const target = (e.target as HTMLElement | null)?.closest('[data-tour-label]') as HTMLElement | null;
      if (!target) { setHover(null); return; }
      const label = target.getAttribute('data-tour-label') ?? '';
      if (!label) { setHover(null); return; }
      setHover({ x: e.clientX, y: e.clientY, label });
    }
    function onLeave() { setHover(null); }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setLegend(false); }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseleave', onLeave);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('keydown', onKey);
    };
  }, [legendMode, setLegend]);

  if (!legendMode) return null;

  return (
    <>
      {/* Outline every labeled region while legend mode is active. */}
      <style>{`
        [data-tour-label] {
          outline: 1.5px dashed var(--ink-accent, #4a5a9a) !important;
          outline-offset: 3px !important;
          border-radius: 6px;
          transition: outline-color 150ms ease;
        }
        [data-tour-label]:hover {
          outline-style: solid !important;
        }
      `}</style>

      {/* Persistent banner so the user knows they're in legend mode. */}
      <div
        style={{
          position: 'fixed',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9998,
          background: 'var(--ink-accent, #4a5a9a)',
          color: 'var(--ink-on-accent, #fff)',
          padding: '6px 14px',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 600,
          boxShadow: '0 6px 20px -4px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        Hover anything to see what it is
        <button
          onClick={() => setLegend(false)}
          style={{
            background: 'rgba(255,255,255,0.18)',
            color: 'inherit',
            border: 'none',
            padding: '3px 10px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Done (Esc)
        </button>
      </div>

      {/* Floating chip that follows the cursor. */}
      {hover && (
        <div
          style={{
            position: 'fixed',
            top: hover.y + 16,
            left: hover.x + 16,
            zIndex: 9999,
            pointerEvents: 'none',
            background: 'var(--ink-text, #111)',
            color: 'var(--ink-bg, #fff)',
            padding: '6px 10px',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 500,
            boxShadow: '0 8px 24px -6px rgba(0,0,0,0.35)',
            maxWidth: 260,
          }}
        >
          {hover.label}
        </div>
      )}
    </>
  );
}
