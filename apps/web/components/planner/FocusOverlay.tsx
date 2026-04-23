'use client';

import { useEffect, useState } from 'react';
import { useFocusStore } from '@/lib/useFocusStore';

const POPUP_W = 420;
const POPUP_H = 640;

function reopenWorkingPopup() {
  const date = new Date().toLocaleDateString('en-CA');
  const left = window.screenX + Math.round((window.outerWidth - POPUP_W) / 2);
  const top = window.screenY + Math.round((window.outerHeight - POPUP_H) / 2);
  window.open(
    `/planner/working/mini?date=${date}`,
    'zentra-mini-working',
    `width=${POPUP_W},height=${POPUP_H},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes`
  );
}

function useElapsed(startedAt: string | null) {
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) { setSecondsElapsed(0); return; }
    const tick = () => setSecondsElapsed(Math.round((Date.now() - new Date(startedAt).getTime()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const mm = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
  const ss = String(secondsElapsed % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * Minimal in-page pill indicator that a focus session is active.
 * The real working UI opens as a separate popup window via useFocusStore.startById/startByTitle.
 * This pill lets the user bring the popup back if they closed it, and provides quick Done/Stop.
 */
export default function FocusOverlay() {
  const { session, complete, abandon } = useFocusStore();
  const [confirmStop, setConfirmStop] = useState(false);
  const elapsed = useElapsed(session?.startedAt ?? null);

  if (!session) return null;

  return (
    <div
      role="complementary"
      aria-label="Focus session active"
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: 'var(--ink-surface)',
        border: '1px solid var(--ink-border)',
        borderRadius: '999px',
        padding: '6px 12px 6px 10px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        fontSize: '12px',
        maxWidth: '300px',
      }}
    >
      {/* Pulsing dot */}
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: 'var(--ink-accent)',
          flexShrink: 0,
          animation: 'fo-pulse 2s ease-in-out infinite',
        }}
      />

      {/* Task label — click to reopen popup */}
      <button
        onClick={reopenWorkingPopup}
        title="Reopen working window"
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: 'var(--ink-text)',
          fontSize: '12px',
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '140px',
          flex: 1,
          textAlign: 'left',
        }}
      >
        {session.taskTitle}
      </button>

      {/* Elapsed time */}
      <span style={{ color: 'var(--ink-text-muted)', fontSize: '11px', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {elapsed}
      </span>

      {/* Done */}
      <button
        onClick={() => { setConfirmStop(false); complete(); }}
        style={{
          background: 'var(--ink-accent)',
          color: 'var(--ink-on-accent)',
          border: 'none',
          borderRadius: '999px',
          padding: '3px 10px',
          fontSize: '11px',
          fontWeight: 600,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        Done
      </button>

      {/* Move on */}
      {!confirmStop ? (
        <button
          onClick={() => setConfirmStop(true)}
          title="Move on from this session"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-text-muted)', padding: '2px', flexShrink: 0, lineHeight: 1 }}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M4 12L12 4M4 4l8 8" strokeLinecap="round"/>
          </svg>
        </button>
      ) : (
        <>
          <button
            onClick={() => abandon()}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-blocked)', fontSize: '11px', fontWeight: 600, padding: '2px 4px', flexShrink: 0 }}
          >
            Move on?
          </button>
          <button
            onClick={() => setConfirmStop(false)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-text-muted)', fontSize: '11px', padding: '2px', flexShrink: 0 }}
          >
            No
          </button>
        </>
      )}

      <style>{`
        @keyframes fo-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}
