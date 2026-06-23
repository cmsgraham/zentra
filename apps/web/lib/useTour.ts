'use client';

/**
 * Product tour store.
 *
 * Drives the first-run walkthrough that explains Zentra's main sections:
 * Studio → Space → Canvas → Today/Flow.
 *
 * Persistence: a single localStorage flag (`zentra_tour_v1`) marks the tour
 * as completed. Bump the version to re-run the tour for everyone after a
 * structural redesign.
 *
 * Steps are defined here (not co-located with screens) so the order stays
 * predictable and the engine is dumb.
 */

import { create } from 'zustand';

export type TourStepKind = 'next' | 'action';

export interface TourStep {
  /** Stable id for analytics + DOM `data-tour` lookup. */
  id: string;
  /** Title shown in the coach card. */
  title: string;
  /** Body — keep it tight, 1–2 sentences. */
  body: string;
  /** Optional route the engine should `router.push` before locating the target. */
  route?: string;
  /**
   * 'next'   = advance on the Next button.
   * 'action' = advance only when something happens in the app (e.g. modal opens,
   *            navigation occurs). The trigger is checked by the engine.
   */
  kind: TourStepKind;
  /** Label shown on the primary advance button. Defaults to "Next". */
  cta?: string;
  /** When kind === 'action', the URL pathname (or pathname prefix) that signals success. */
  advanceOnPath?: string;
  /** When kind === 'action', a DOM presence check that signals success (e.g. modal mounted). */
  advanceOnSelector?: string;
  /**
   * Where to place the tooltip relative to the spotlight target.
   * Defaults to 'auto' which picks the side with the most room.
   */
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'auto' | 'center';
}

export const TOUR_VERSION = 'v3';
const STORAGE_KEY = `zentra_tour_${TOUR_VERSION}`;

export const TOUR_STEPS: TourStep[] = [
  // ───────────── Studio ─────────────
  {
    id: 'studio',
    title: 'Welcome to Studio',
    body:
      'Studio is the home for everything you’re building. Each card here is a Space — a separate world for one project, role, or area of life (Work, Studies, Side Project…).',
    route: '/workspaces',
    kind: 'next',
    placement: 'auto',
  },
  {
    id: 'create-space',
    title: 'Create your first Space',
    body:
      'A Space holds the intentions, notes, and goals for one chunk of your life. Click New to make one.',
    kind: 'action',
    advanceOnSelector: '[data-tour="name-space"]',
    cta: 'Click New →',
    placement: 'auto',
  },
  {
    id: 'name-space',
    title: 'Name it something real',
    body:
      'Pick a name that makes you go “oh, that one”. You can rename it later. When you’re happy, hit Create.',
    kind: 'action',
    advanceOnPath: '/workspaces/',
    placement: 'auto',
  },

  // ───────────── Inside a Space ─────────────
  {
    id: 'workspace-board',
    title: 'This is your Space',
    body:
      'Every Space gives you a board for its intentions — the things you want to do here. Let’s look at how to add them.',
    kind: 'next',
    placement: 'center',
  },
  {
    id: 'quick-add',
    title: 'Easy way: just type',
    body:
      'Type a title here and press Enter. The intention drops into the Open lane. Perfect for capturing things on the fly.',
    kind: 'next',
    placement: 'right',
  },
  {
    id: 'new-intention-button',
    title: 'Full way: New Intention',
    body:
      'Need more? This opens the full form — description, priority, due date, estimated time, tags. Use it when an intention has shape.',
    kind: 'next',
    placement: 'bottom',
  },
  {
    id: 'board-states',
    title: 'Four states, one journey',
    body:
      'Open is what you intend to do. Present is what you’re doing now. Waiting on… is paused on someone or something else. I did it! is the celebration. Drag cards between them.',
    kind: 'next',
    placement: 'top',
  },
  {
    id: 'share',
    title: 'Share a Space',
    body:
      'Spaces are private by default. Invite collaborators when you want to share intentions, comments, and progress.',
    kind: 'next',
    placement: 'bottom',
  },
  {
    id: 'text-import',
    title: 'Text Import',
    body:
      'Already have a list somewhere? Paste it in and Zentra will turn each line into an intention.',
    kind: 'next',
    placement: 'right',
  },
  {
    id: 'image-import',
    title: 'Image Import — with AI ✨',
    body:
      'This one’s special. Snap a photo of a whiteboard, sticky notes, or a handwritten list — Zentra reads it and creates intentions for you. Try it on the messy stuff.',
    kind: 'next',
    placement: 'right',
  },

  // ───────────── Canvas ─────────────
  {
    id: 'canvas',
    title: 'Canvas — your day at a glance',
    body:
      'Canvas pulls from every Space and gives you one place to plan a day: goals, schedule, mood, and the one thing that matters most.',
    route: '/planner',
    kind: 'next',
    placement: 'center',
  },
  {
    id: 'goals',
    title: 'Today’s Goals',
    body:
      'Goals are added by you, manually — that’s the point. Tap “+ intention” and pick what actually matters today. Less is more.',
    kind: 'next',
    placement: 'auto',
  },
  {
    id: 'shape-flow',
    title: 'Shape flow with AI',
    body:
      'Tell Zentra how your day feels and it’ll arrange your goals + appointments into a calm, realistic schedule. You stay in control — it just drafts.',
    kind: 'next',
    placement: 'bottom',
  },
  {
    id: 'schedule',
    title: 'Schedule',
    body:
      'Real-world meetings and appointments live here. Add them by hand, or use Import to extract them from a screenshot of your calendar.',
    kind: 'next',
    placement: 'auto',
  },
  {
    id: 'import-schedule',
    title: 'Import Schedule — the magic shortcut',
    body:
      'Zentra doesn’t (yet) sync with Google/Apple/Outlook calendars. Instead, take a screenshot of your day or week, drop it here, and AI extracts every meeting with date and time. Fastest way to get your day in.',
    kind: 'next',
    placement: 'auto',
  },
  {
    id: 'edit-layout',
    title: 'Edit Layout',
    body:
      'Canvas is yours. Rearrange the widgets — schedule, goals, mood, calendar — until the page reflects how *you* think.',
    kind: 'next',
    placement: 'bottom',
  },

  // ───────────── Flow ─────────────
  {
    id: 'today',
    title: 'Flow — where the day actually happens',
    body:
      'Flow shows you one thing at a time: today’s focus and a single Start button. No lists, no choosing. Just the next move.',
    route: '/today',
    kind: 'next',
    placement: 'bottom',
  },

  // ───────────── The rest of the nav ─────────────
  {
    id: 'lists',
    title: 'Lists',
    body:
      'Lists is for the lightweight stuff that doesn’t belong on a Space board — shopping, packing, errands, checklists. Snap a photo of a recipe and Zentra builds the list for you.',
    kind: 'next',
    placement: 'bottom',
  },
  {
    id: 'echoes',
    title: 'Echoes',
    body:
      'Echoes are gentle reminders — “water the plants every Tuesday”, “call mom Sunday”. They live outside intentions so they don’t clutter your boards.',
    kind: 'next',
    placement: 'bottom',
  },
  {
    id: 'help',
    title: 'Help & Guide',
    body:
      'Stuck? The help icon opens a guide with FAQs, examples, and a button to replay this tour anytime.',
    kind: 'next',
    placement: 'bottom',
  },
  {
    id: 'profile',
    title: 'Profile & Settings',
    body:
      'Your name, timezone, working hours, default session length, AI opt-in, and a Restart Tour button — all live here. That’s it, you’re ready. Welcome to Zentra. 🌱',
    kind: 'next',
    cta: 'Finish tour',
    placement: 'bottom',
  },
];

interface TourState {
  active: boolean;
  index: number;
  legendMode: boolean;
  start: () => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  finish: () => void;
  setLegend: (on: boolean) => void;
  /** Auto-start if the user has never completed the tour. Safe to call repeatedly. */
  autoStart: () => void;
}

function readDone(): boolean {
  if (typeof window === 'undefined') return true;
  try { return window.localStorage.getItem(STORAGE_KEY) === 'done'; } catch { return false; }
}
function writeDone() {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, 'done'); } catch { /* ignore */ }
}

export const useTour = create<TourState>((set, get) => ({
  active: false,
  index: 0,
  legendMode: false,
  start: () => set({ active: true, index: 0 }),
  next: () => {
    const i = get().index;
    if (i >= TOUR_STEPS.length - 1) { writeDone(); set({ active: false, index: 0 }); }
    else set({ index: i + 1 });
  },
  back: () => set({ index: Math.max(0, get().index - 1) }),
  skip: () => { writeDone(); set({ active: false, index: 0 }); },
  finish: () => { writeDone(); set({ active: false, index: 0 }); },
  setLegend: (on) => set({ legendMode: on }),
  autoStart: () => {
    if (readDone()) return;
    if (get().active) return;
    set({ active: true, index: 0 });
  },
}));

export function isTourDone(): boolean { return readDone(); }
export function resetTour() {
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}
