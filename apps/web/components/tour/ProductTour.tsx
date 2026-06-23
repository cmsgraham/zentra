'use client';

/**
 * ProductTour
 *
 * Renders the first-run walkthrough overlay:
 *   • A dimmed full-page backdrop with an SVG mask cutting a "spotlight"
 *     hole around the current step's target element.
 *   • A coach card (title + body + Back/Next/Skip) anchored next to the
 *     spotlight, auto-flipped to whichever side has more room.
 *   • Optional 'action' steps that advance when the user actually performs
 *     a gesture in the real UI (e.g. opens the create-space modal, lands
 *     on /workspaces/:id).
 *
 * Targets are discovered via `[data-tour="<step.id>"]` selectors on real UI
 * elements — keeps the engine decoupled from page internals.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { TOUR_STEPS, useTour } from '@/lib/useTour';

interface Rect { top: number; left: number; width: number; height: number; }

const PADDING = 8;       // breathing room around the spotlight
const CARD_W = 320;
const CARD_GAP = 14;     // distance from spotlight edge to card

function getRect(el: Element | null): Rect | null {
  if (!el) return null;
  const r = (el as HTMLElement).getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function placeCard(
  spotlight: Rect | null,
  preferred: 'top' | 'bottom' | 'left' | 'right' | 'auto' | 'center' = 'auto',
  cardH = 200,
): { top: number; left: number; arrow: 'top' | 'bottom' | 'left' | 'right' | 'none' } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!spotlight || preferred === 'center') {
    return { top: Math.max(24, (vh - cardH) / 2), left: Math.max(24, (vw - CARD_W) / 2), arrow: 'none' };
  }
  const room = {
    top: spotlight.top,
    bottom: vh - (spotlight.top + spotlight.height),
    left: spotlight.left,
    right: vw - (spotlight.left + spotlight.width),
  };
  let side = preferred;
  if (side === 'auto') {
    side = ([...(['bottom', 'top', 'right', 'left'] as const)] as ('bottom' | 'top' | 'right' | 'left')[])
      .sort((a, b) => room[b] - room[a])[0];
  }
  let top = 0, left = 0;
  switch (side) {
    case 'bottom':
      top = spotlight.top + spotlight.height + CARD_GAP;
      left = spotlight.left + spotlight.width / 2 - CARD_W / 2;
      break;
    case 'top':
      top = spotlight.top - cardH - CARD_GAP;
      left = spotlight.left + spotlight.width / 2 - CARD_W / 2;
      break;
    case 'right':
      top = spotlight.top + spotlight.height / 2 - cardH / 2;
      left = spotlight.left + spotlight.width + CARD_GAP;
      break;
    case 'left':
      top = spotlight.top + spotlight.height / 2 - cardH / 2;
      left = spotlight.left - CARD_W - CARD_GAP;
      break;
  }
  // clamp inside viewport
  left = Math.max(16, Math.min(left, vw - CARD_W - 16));
  top = Math.max(16, Math.min(top, vh - cardH - 16));
  return { top, left, arrow: side as 'top' | 'bottom' | 'left' | 'right' };
}

export default function ProductTour() {
  const router = useRouter();
  const pathname = usePathname();
  const { active, index, next, back, skip } = useTour();
  const step = active ? TOUR_STEPS[index] : null;

  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardSize, setCardSize] = useState<{ w: number; h: number }>({ w: CARD_W, h: 200 });

  // Route side-effect: if the step requests a route, push it (only when not already there).
  useEffect(() => {
    if (!step?.route) return;
    if (!pathname?.startsWith(step.route)) router.push(step.route);
  }, [step, pathname, router]);

  // Locate the target element. Retry briefly because the route may still be mounting.
  useLayoutEffect(() => {
    if (!step) { setRect(null); return; }
    let raf = 0;
    let tries = 0;
    const find = () => {
      const el = document.querySelector(`[data-tour="${step.id}"]`);
      const r = getRect(el);
      if (r) { setRect(r); return; }
      if (tries++ < 60) raf = requestAnimationFrame(find); // ~1s of retries
      else setRect(null); // fall back to centered card
    };
    find();
    return () => cancelAnimationFrame(raf);
  }, [step, pathname]);

  // Reposition on scroll / resize.
  useEffect(() => {
    if (!step) return;
    const reflow = () => {
      const el = document.querySelector(`[data-tour="${step.id}"]`);
      setRect(getRect(el));
    };
    window.addEventListener('scroll', reflow, true);
    window.addEventListener('resize', reflow);
    return () => {
      window.removeEventListener('scroll', reflow, true);
      window.removeEventListener('resize', reflow);
    };
  }, [step]);

  // Track card size so placement math is accurate.
  useLayoutEffect(() => {
    if (!cardRef.current) return;
    const el = cardRef.current;
    const ro = new ResizeObserver(() => {
      setCardSize({ w: el.offsetWidth, h: el.offsetHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [step?.id]);

  // Auto-advance for 'action' steps.
  useEffect(() => {
    if (!step || step.kind !== 'action') return;

    // Path-based trigger
    if (step.advanceOnPath && pathname?.startsWith(step.advanceOnPath)) {
      // Only advance if pathname is *more specific* than the route that brought us here
      // (e.g. /workspaces/abc, not /workspaces).
      if (pathname !== step.advanceOnPath && pathname !== '/workspaces') {
        next();
        return;
      }
    }

    // Selector-based trigger (poll cheaply; modals mount/unmount infrequently).
    if (step.advanceOnSelector) {
      const id = window.setInterval(() => {
        if (document.querySelector(step.advanceOnSelector!)) {
          window.clearInterval(id);
          next();
        }
      }, 200);
      return () => window.clearInterval(id);
    }
  }, [step, pathname, next]);

  if (!step) return null;

  const spotlight = rect
    ? { top: rect.top - PADDING, left: rect.left - PADDING, width: rect.width + PADDING * 2, height: rect.height + PADDING * 2 }
    : null;

  const place = placeCard(spotlight, step.placement ?? 'auto', cardSize.h);
  const isLast = index === TOUR_STEPS.length - 1;
  const isAction = step.kind === 'action';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Product tour"
      style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none' }}
    >
      {/* Dim overlay with spotlight cutout. pointer-events: auto on the SVG so
          clicks outside the spotlight are absorbed during 'next' steps, but
          the cutout remains click-through. */}
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, pointerEvents: isAction ? 'none' : 'auto' }}
      >
        <defs>
          <mask id="zentra-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {spotlight && (
              <rect
                x={spotlight.left}
                y={spotlight.top}
                width={spotlight.width}
                height={spotlight.height}
                rx={12}
                ry={12}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(8, 12, 28, 0.55)"
          mask="url(#zentra-tour-mask)"
        />
      </svg>

      {/* Spotlight ring (purely decorative; doesn't block clicks) */}
      {spotlight && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            borderRadius: 12,
            boxShadow: '0 0 0 2px var(--ink-accent, #4a5a9a), 0 12px 40px -8px rgba(0,0,0,0.4)',
            pointerEvents: 'none',
            transition: 'all 220ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      )}

      {/* Coach card */}
      <div
        ref={cardRef}
        style={{
          position: 'absolute',
          top: place.top,
          left: place.left,
          width: CARD_W,
          maxWidth: 'calc(100vw - 32px)',
          background: 'var(--ink-surface, #fff)',
          color: 'var(--ink-text, #111)',
          border: '1px solid var(--ink-border-subtle, rgba(0,0,0,0.08))',
          borderRadius: 14,
          boxShadow: '0 24px 60px -12px rgba(0,0,0,0.35), 0 4px 12px -4px rgba(0,0,0,0.18)',
          padding: 18,
          pointerEvents: 'auto',
          transition: 'top 220ms cubic-bezier(0.4, 0, 0.2, 1), left 220ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span
            style={{
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--ink-text-muted, #6b7280)',
              fontWeight: 600,
            }}
          >
            Step {index + 1} of {TOUR_STEPS.length}
          </span>
          <button
            onClick={skip}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 12,
              color: 'var(--ink-text-muted, #6b7280)',
              cursor: 'pointer',
              padding: 4,
            }}
            aria-label="Skip tour"
          >
            Skip
          </button>
        </div>
        <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 650, lineHeight: 1.3 }}>
          {step.title}
        </h3>
        <p style={{ margin: '8px 0 16px', fontSize: '0.875rem', lineHeight: 1.55, color: 'var(--ink-text-secondary, #374151)' }}>
          {step.body}
        </p>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
          {TOUR_STEPS.map((_, i) => (
            <span
              key={i}
              style={{
                width: i === index ? 18 : 6,
                height: 6,
                borderRadius: 3,
                background: i === index ? 'var(--ink-accent, #4a5a9a)' : 'var(--ink-border, #e5e7eb)',
                transition: 'width 200ms ease',
              }}
            />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={back}
            disabled={index === 0}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 13,
              color: index === 0 ? 'var(--ink-border, #d1d5db)' : 'var(--ink-text-muted, #6b7280)',
              cursor: index === 0 ? 'default' : 'pointer',
              padding: '6px 4px',
            }}
          >
            Back
          </button>
          {isAction ? (
            <span style={{ fontSize: 12, color: 'var(--ink-text-muted, #6b7280)', fontStyle: 'italic' }}>
              {step.cta ?? 'Try it'}
            </span>
          ) : (
            <button
              onClick={next}
              className="z-btn z-btn-primary z-btn-sm"
              style={{
                fontSize: 13,
                padding: '8px 16px',
                borderRadius: 8,
                background: 'var(--ink-accent, #4a5a9a)',
                color: 'var(--ink-on-accent, #fff)',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {step.cta ?? (isLast ? 'Finish' : 'Next')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
