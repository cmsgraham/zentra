'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { usePlannerLayout, type WidgetId } from '@/lib/planner-layout';
import LayoutEditor from '@/components/planner/LayoutEditor';
import MiniCalendar, { type CalendarDayData } from '@/components/planner/MiniCalendar';
import MoodSelector from '@/components/planner/MoodSelector';
import PomodoroTimer from '@/components/planner/PomodoroTimer';
import AppointmentCard, { type AppointmentData } from '@/components/appointments/AppointmentCard';
import AppointmentForm from '@/components/appointments/AppointmentForm';
import AIPlannerModal from '@/components/planner/AIPlannerModal';
import AICalendarExtractModal from '@/components/planner/AICalendarExtractModal';
import TodayPlanWidget from '@/components/planner/TodayPlanWidget';
import { api } from '@/lib/api-client';
import type { TaskData } from '@/components/tasks/TaskCard';

interface PlanData {
  id: string;
  planDate: string;
  mood: string | null;
  reminderText: string | null;
  topPriorityText: string | null;
  notes: string | null;
  reflection: string | null;
  tomorrowNotes: string | null;
  planBlocks: { start: string; end: string; type: string; tasks: string[] }[] | null;
}

interface GoalData {
  id: string;
  dailyPlanId: string;
  title: string;
  status: string;
  linkedTaskId: string | null;
  linkedTask?: {
    id: string;
    title: string;
    status: string;
    priority: string;
    createdAt: string;
    openDays: number | null;
  } | null;
  sortOrder: number;
}

interface PlannerViewProps {
  /** When set, Due Tasks card filters to this workspace only */
  workspaceId?: string;
  workspaceName?: string;
}

function isoDate(d: Date) {
  return d.toLocaleDateString('en-CA');
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Open',
  in_progress: 'Present',
  blocked: 'Waiting on…',
  done: 'I did it!',
};
function statusLabel(s: string): string {
  return STATUS_LABELS[s] ?? s.replace('_', ' ');
}

/* ── Reusable card wrapper with paper-planner feel ── */
function PlannerCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg p-3.5 flex flex-col h-full ${className}`}
      style={{
        background: 'var(--ink-card-bg)',
        border: '1px solid var(--ink-border-subtle)',
        boxShadow: 'var(--ink-shadow-sm)',
      }}
    >
      {children}
    </div>
  );
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="z-label mb-1.5">
      {children}
    </p>
  );
}

export default function PlannerView({ workspaceId, workspaceName }: PlannerViewProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { layout, editingLayout, loaded, init: initLayout, setLayout, setEditingLayout, resetLayout } = usePlannerLayout();

  // Init layout from API
  useEffect(() => { initLayout(); }, []);

  // Date state
  const today = new Date();
  const [selectedDate, setSelectedDate] = useState(isoDate(today));
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  // Data
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [goals, setGoals] = useState<GoalData[]>([]);
  const [appointments, setAppointments] = useState<AppointmentData[]>([]);
  const [dueTasks, setDueTasks] = useState<TaskData[]>([]);
  const [overdueTasks, setOverdueTasks] = useState<TaskData[]>([]);
  const [calendarDays, setCalendarDays] = useState<CalendarDayData[]>([]);

  // UI state
  const [showApptForm, setShowApptForm] = useState(false);
  const [editingAppt, setEditingAppt] = useState<AppointmentData | null>(null);
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');
  const [availableTasks, setAvailableTasks] = useState<TaskData[]>([]);

  // AI Planner state
  const [showAIPlanner, setShowAIPlanner] = useState(false);
  const [showAIExtract, setShowAIExtract] = useState(false);

  // Quick-create task state
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickPriority, setQuickPriority] = useState('medium');
  const [quickWorkspaceId, setQuickWorkspaceId] = useState(workspaceId ?? '');
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [quickCreating, setQuickCreating] = useState(false);

  // Planner form fields
  const [mood, setMood] = useState('');
  const [topPriority, setTopPriority] = useState('');
  const [planNotes, setPlanNotes] = useState('');
  const [reflection, setReflection] = useState('');
  const [tomorrowNotes, setTomorrowNotes] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef(false);

  // Task query string — optionally scoped to a workspace
  const taskQs = workspaceId ? `&workspaceId=${workspaceId}` : '';

  // Load planner data — always global (shared across workspaces).
  // #1 Priority is pre-filled from the Flow priority (/priority/today) when
  // the plan hasn't stored its own topPriorityText yet; otherwise stays blank.
  const loadPlannerData = useCallback(async () => {
    loadedRef.current = false;
    const [data, flowPriority] = await Promise.all([
      api<{ plan: PlanData | null; goals: GoalData[] }>(`/planner?date=${selectedDate}`),
      api<{ task: { title: string } | null }>('/priority/today').catch(() => ({ task: null })),
    ]);
    setPlan(data.plan);
    setGoals(data.goals);
    if (data.plan) {
      setMood(data.plan.mood ?? '');
      setTopPriority(data.plan.topPriorityText ?? flowPriority.task?.title ?? '');
      setPlanNotes(data.plan.notes ?? '');
      setReflection(data.plan.reflection ?? '');
      setTomorrowNotes(data.plan.tomorrowNotes ?? '');
    } else {
      setMood('');
      setTopPriority(flowPriority.task?.title ?? '');
      setPlanNotes(''); setReflection(''); setTomorrowNotes('');
    }
    setTimeout(() => { loadedRef.current = true; }, 50);
  }, [selectedDate]);

  // Load appointments — always global
  const loadAppointments = useCallback(async () => {
    const data = await api<{ items: AppointmentData[] }>(`/appointments?date=${selectedDate}`);
    setAppointments(data.items);
  }, [selectedDate]);

  // Load tasks — filtered by workspace when provided
  const loadTasks = useCallback(async () => {
    const [dueData, overdueData] = await Promise.all([
      api<{ items: TaskData[] }>(`/my/tasks?dueDate=${selectedDate}&pageSize=50${taskQs}`),
      api<{ items: TaskData[] }>(`/my/tasks?overdue=true&pageSize=50${taskQs}`),
    ]);
    setDueTasks(dueData.items);
    setOverdueTasks(overdueData.items.filter((t) => t.dueDate?.slice(0, 10) !== selectedDate));
  }, [selectedDate, taskQs]);

  // Load calendar summary — always global
  const loadCalendarSummary = useCallback(async () => {
    const monthStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;
    const data = await api<{ days: CalendarDayData[] }>(`/planner/calendar-summary?month=${monthStr}`);
    setCalendarDays(data.days);
  }, [calYear, calMonth]);

  useEffect(() => { if (user) loadPlannerData(); }, [user, loadPlannerData]);
  useEffect(() => { if (user) loadAppointments(); }, [user, loadAppointments]);
  useEffect(() => { if (user) loadTasks(); }, [user, loadTasks]);
  useEffect(() => { if (user) loadCalendarSummary(); }, [user, loadCalendarSummary]);

  // Auto-save — debounced upsert on any field change
  const autoSave = useCallback(async (fields: Partial<{
    mood: string | null; topPriorityText: string | null;
    notes: string | null; reflection: string | null; tomorrowNotes: string | null;
  }>) => {
    if (!loadedRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      const result = await api<{ plan: PlanData; goals: GoalData[] }>('/planner', {
        method: 'PUT',
        body: { date: selectedDate, ...fields },
      });
      setPlan(result.plan);
      setGoals(result.goals);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
      loadCalendarSummary();
    }, 800);
  }, [selectedDate, loadCalendarSummary]);

  // Flush pending auto-save immediately (for mood / instant actions)
  const saveNow = useCallback(async (fields: Partial<{
    mood: string | null; topPriorityText: string | null;
    notes: string | null; reflection: string | null; tomorrowNotes: string | null;
  }>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveStatus('saving');
    const result = await api<{ plan: PlanData; goals: GoalData[] }>('/planner', {
      method: 'PUT',
      body: { date: selectedDate, ...fields },
    });
    setPlan(result.plan);
    setGoals(result.goals);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 1500);
    loadCalendarSummary();
  }, [selectedDate, loadCalendarSummary]);

  // Cleanup debounce on unmount / date change
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [selectedDate]);

  // Wrapped setters that trigger auto-save
  function updateMood(v: string) { setMood(v); saveNow({ mood: v || null }); }
  function updateTopPriority(v: string) { setTopPriority(v); autoSave({ topPriorityText: v || null }); }
  function updatePlanNotes(v: string) { setPlanNotes(v); autoSave({ notes: v || null }); }
  function updateReflection(v: string) { setReflection(v); autoSave({ reflection: v || null }); }
  function updateTomorrowNotes(v: string) { setTomorrowNotes(v); autoSave({ tomorrowNotes: v || null }); }

  async function addGoal() {
    if (!newGoalTitle.trim()) return;
    let planId = plan?.id;
    if (!planId) {
      const result = await api<{ plan: PlanData }>('/planner', {
        method: 'PUT',
        body: { date: selectedDate },
      });
      setPlan(result.plan);
      planId = result.plan.id;
    }
    await api(`/planner/${planId}/goals`, {
      method: 'POST',
      body: { title: newGoalTitle.trim(), sortOrder: goals.length },
    });
    setNewGoalTitle('');
    await loadPlannerData();
  }

  // Load tasks for picker — always cross-workspace so goals can link any task
  async function loadAvailableTasks() {
    const data = await api<{ items: TaskData[] }>(`/my/tasks?pageSize=100`);
    const linkedIds = new Set(goals.filter(g => g.linkedTaskId).map(g => g.linkedTaskId));
    setAvailableTasks(data.items.filter(t => !linkedIds.has(t.id) && t.status !== 'done'));
  }

  async function addTaskAsGoal(task: TaskData) {
    let planId = plan?.id;
    if (!planId) {
      const result = await api<{ plan: PlanData }>('/planner', {
        method: 'PUT',
        body: { date: selectedDate },
      });
      setPlan(result.plan);
      planId = result.plan.id;
    }
    await api(`/planner/${planId}/goals`, {
      method: 'POST',
      body: {
        title: task.title,
        linkedTaskId: task.id,
        sortOrder: goals.length,
      },
    });
    // Picker stays open so multiple intentions can be added in one go.
    setTaskSearch('');
    await loadPlannerData();
    await loadTasks();
  }

  const filteredTasks = taskSearch
    ? availableTasks.filter(t => t.title.toLowerCase().includes(taskSearch.toLowerCase()))
    : availableTasks;

  async function toggleGoal(goal: GoalData) {
    const newStatus = goal.status === 'done' ? 'pending' : 'done';
    await api(`/planner/goals/${goal.id}`, { method: 'PATCH', body: { status: newStatus } });
    await loadPlannerData();
  }

  async function deleteGoal(goalId: string) {
    await api(`/planner/goals/${goalId}`, { method: 'DELETE' });
    await loadPlannerData();
  }

  async function deleteAppointment(id: string) {
    await api(`/appointments/${id}`, { method: 'DELETE' });
    await loadAppointments();
    await loadCalendarSummary();
  }

  // Load workspaces for quick-create picker (global planner only)
  useEffect(() => {
    if (user && !workspaceId) {
      api<{ items: { id: string; name: string }[] }>('/workspaces')
        .then((d) => {
          setWorkspaces(d.items);
          if (d.items.length === 1) setQuickWorkspaceId(d.items[0].id);
        })
        .catch(() => {});
    }
  }, [user, workspaceId]);

  async function quickCreateTask() {
    if (!quickTitle.trim()) return;
    const targetWs = workspaceId || quickWorkspaceId;
    if (!targetWs) return;
    setQuickCreating(true);
    await api(`/workspaces/${targetWs}/tasks`, {
      method: 'POST',
      body: {
        title: quickTitle.trim(),
        priority: quickPriority,
        status: 'pending',
        dueDate: new Date(selectedDate + 'T12:00:00').toISOString(),
      },
    });
    setQuickCreating(false);
    setQuickTitle('');
    setShowQuickCreate(false);
    await loadTasks();
  }

  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); }
    else setCalMonth(calMonth - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); }
    else setCalMonth(calMonth + 1);
  }

  function handleSelectDate(date: string) {
    setSelectedDate(date);
    const [y, m] = date.split('-').map(Number);
    setCalYear(y);
    setCalMonth(m - 1);
  }

  const selectedLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const isToday = selectedDate === isoDate(new Date());

  const priorityColor = (p: string) => {
    if (p === 'critical') return 'var(--ink-critical)';
    if (p === 'high') return 'var(--ink-high)';
    if (p === 'medium') return 'var(--ink-medium)';
    return 'var(--ink-low)';
  };

  const goalsCompleted = goals.filter(g => g.status === 'done').length;

  const dueLabel = workspaceName
    ? `Due ${isToday ? 'Today' : 'This Day'} · ${workspaceName}`
    : `Due ${isToday ? 'Today' : 'This Day'}`;

  /* ── Widget renderer ── */

  function renderWidget(wid: WidgetId) {
    switch (wid) {
      case 'calendar-mood':
        return (
          <PlannerCard>
            <CardLabel>Calendar</CardLabel>
            <MiniCalendar
              year={calYear}
              month={calMonth}
              selectedDate={selectedDate}
              onSelectDate={handleSelectDate}
              onPrevMonth={prevMonth}
              onNextMonth={nextMonth}
              dayData={calendarDays}
            />
          </PlannerCard>
        );

      case 'schedule':
        return (
          <PlannerCard>
            <div className="flex items-center justify-between">
              <CardLabel>Schedule</CardLabel>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowAIExtract(true)}
                  className="text-[10px] px-2 py-0.5 rounded transition-colors duration-100 hover:opacity-80"
                  style={{ color: 'var(--ink-accent)' }}
                >
                  import
                </button>
                <button
                  onClick={() => { setEditingAppt(null); setShowApptForm(true); }}
                  className="text-[10px] px-2 py-0.5 rounded transition-colors duration-100 hover:opacity-80"
                  style={{ color: 'var(--ink-accent)' }}
                >
                  + add
                </button>
              </div>
            </div>
            {appointments.length === 0 ? (
              <p className="text-[11px] py-2 text-center" style={{ color: 'var(--ink-text-muted)', opacity: 0.5 }}>
                No appointments scheduled
              </p>
            ) : (
              <div className="space-y-0.5">
                {appointments.map((appt) => (
                  <AppointmentCard
                    key={appt.id}
                    appointment={appt}
                    onEdit={(a) => { setEditingAppt(a); setShowApptForm(true); }}
                    onDelete={deleteAppointment}
                  />
                ))}
              </div>
            )}
            <div className="mt-3 pt-2" style={{ borderTop: '1px solid color-mix(in srgb, var(--ink-border) 30%, transparent)' }}>
              <CardLabel>#1 Priority</CardLabel>
              <input
                value={topPriority}
                onChange={(e) => updateTopPriority(e.target.value)}
                placeholder="The one thing that matters most..."
                className="w-full text-sm font-medium py-1 bg-transparent outline-none transition-colors duration-100"
                style={{
                  borderBottom: '1.5px solid color-mix(in srgb, var(--ink-accent) 40%, transparent)',
                  color: 'var(--ink-text)',
                }}
              />
            </div>
          </PlannerCard>
        );

      case 'goals':
        return (
          <PlannerCard>
            <div className="flex items-center justify-between">
              <CardLabel>Today&apos;s Goals</CardLabel>
              <button
                onClick={() => { setShowTaskPicker(!showTaskPicker); if (!showTaskPicker) loadAvailableTasks(); }}
                className="text-[10px] px-2 py-0.5 rounded transition-colors duration-100 hover:opacity-80"
                style={{ color: 'var(--ink-accent)' }}
              >
                {showTaskPicker ? 'done' : '+ intention'}
              </button>
            </div>

            {showTaskPicker && (
              <div
                className="mb-2 rounded-lg overflow-hidden"
                style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)' }}
              >
                <input
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                  placeholder="Search intentions..."
                  autoFocus
                  className="w-full text-xs px-2 py-1.5 bg-transparent outline-none"
                  style={{ borderBottom: '1px solid var(--ink-border)' }}
                />
                <div className="max-h-32 overflow-y-auto">
                  {filteredTasks.length === 0 ? (
                    <p className="text-[10px] px-2 py-2 text-center" style={{ color: 'var(--ink-text-muted)' }}>
                      No matching intentions
                    </p>
                  ) : (
                    filteredTasks.slice(0, 8).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => addTaskAsGoal(t)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-black/5 transition-colors duration-100"
                      >
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: priorityColor(t.priority) }} />
                        <span className="text-xs flex-1 truncate">{t.title}</span>
                        {(t as any).workspaceName && (
                          <span className="text-[8px] px-1 py-px rounded shrink-0" style={{ background: 'var(--ink-subtle)', color: 'var(--ink-text-muted)' }}>
                            {(t as any).workspaceName}
                          </span>
                        )}
                        <span className="text-[9px] shrink-0" style={{ color: 'var(--ink-text-muted)' }}>{t.status.replace('_', ' ')}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Goals list */}
            {goals.length > 0 && (
              <div className="mb-2">
                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--ink-border) 30%, transparent)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${goals.length > 0 ? (goalsCompleted / goals.length) * 100 : 0}%`,
                      background: 'var(--ink-done)',
                    }}
                  />
                </div>
                <p className="text-[9px] mt-0.5 text-right" style={{ color: 'var(--ink-text-muted)' }}>
                  {goalsCompleted}/{goals.length} completed
                </p>
              </div>
            )}
            <div className="space-y-px flex-1 overflow-y-auto">
              {goals.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center gap-2 py-1 group transition-colors duration-100"
                  style={{ borderBottom: '1px solid color-mix(in srgb, var(--ink-border) 25%, transparent)' }}
                >
                  <button
                    onClick={() => toggleGoal(g)}
                    className="w-4 h-4 rounded border flex items-center justify-center shrink-0 text-[10px] transition-all duration-150"
                    style={{
                      borderColor: g.status === 'done' ? 'var(--ink-done)' : 'color-mix(in srgb, var(--ink-border) 80%, transparent)',
                      background: g.status === 'done' ? 'var(--ink-done)' : 'transparent',
                      color: g.status === 'done' ? 'var(--ink-on-accent)' : 'transparent',
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="2 6 5 9 10 3"/></svg>
                  </button>
                  <div className="flex-1 min-w-0">
                    <span
                      className="text-xs block truncate transition-all duration-150"
                      style={{
                        textDecoration: g.status === 'done' ? 'line-through' : 'none',
                        color: g.status === 'done' ? 'var(--ink-text-muted)' : 'var(--ink-text)',
                      }}
                    >
                      {g.title}
                    </span>
                    {g.linkedTask && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] px-1 py-px rounded-sm" style={{
                          background: g.linkedTask.status === 'in_progress' ? 'var(--ink-in-progress)'
                            : g.linkedTask.status === 'blocked' ? 'var(--ink-blocked)'
                            : g.linkedTask.status === 'done' ? 'var(--ink-done)'
                            : 'var(--ink-pending)',
                          color: 'var(--ink-on-accent)', opacity: 0.85,
                        }}>
                          {statusLabel(g.linkedTask.status)}
                        </span>
                        {g.linkedTask.openDays !== null && (
                          <span className="text-[9px]" style={{ color: 'var(--ink-text-muted)' }}>
                            {g.linkedTask.openDays === 0 ? 'today' : `${g.linkedTask.openDays}d open`}
                          </span>
                        )}
                        <span className="w-1 h-1 rounded-full shrink-0" style={{ background: priorityColor(g.linkedTask.priority) }} />
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => deleteGoal(g.id)}
                    className="text-[10px] px-1 py-0.5 rounded opacity-0 group-hover:opacity-80 transition-opacity duration-100 hover:bg-black/5"
                    style={{ color: 'var(--ink-blocked)' }}
                    title="Remove from goals"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); addGoal(); }} className="mt-1">
              <input
                value={newGoalTitle}
                onChange={(e) => setNewGoalTitle(e.target.value)}
                placeholder="+ Add a custom goal..."
                className="w-full text-xs py-1 bg-transparent outline-none transition-colors duration-100"
                style={{
                  borderBottom: '1px dashed color-mix(in srgb, var(--ink-border) 50%, transparent)',
                  color: 'var(--ink-text)',
                }}
              />
            </form>
          </PlannerCard>
        );

      case 'pomodoro':
        return (
          <PlannerCard>
            <CardLabel>Focus Timer</CardLabel>
            <PomodoroTimer />
          </PlannerCard>
        );

      case 'due-tasks':
        return (
          <PlannerCard>
            <div className="flex items-center justify-between">
              <CardLabel>{dueLabel}</CardLabel>
              <button
                onClick={() => setShowQuickCreate(!showQuickCreate)}
                className="text-[10px] px-2 py-0.5 rounded transition-colors duration-100 hover:opacity-80"
                style={{ color: 'var(--ink-accent)' }}
              >
                {showQuickCreate ? 'cancel' : '+ new'}
              </button>
            </div>

            {/* Quick-create task form */}
            {showQuickCreate && (
              <form
                onSubmit={(e) => { e.preventDefault(); quickCreateTask(); }}
                className="mb-2 rounded-lg p-2 space-y-1.5"
                style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)' }}
              >
                <input
                  value={quickTitle}
                  onChange={(e) => setQuickTitle(e.target.value)}
                  placeholder="Intention title..."
                  autoFocus
                  required
                  className="w-full text-xs px-2 py-1.5 bg-transparent outline-none rounded"
                  style={{ border: '1px solid var(--ink-border)' }}
                />
                <div className="flex items-center gap-1.5">
                  <select
                    value={quickPriority}
                    onChange={(e) => setQuickPriority(e.target.value)}
                    className="text-[10px] px-1.5 py-1 rounded bg-transparent outline-none flex-1"
                    style={{ border: '1px solid var(--ink-border)' }}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                  {!workspaceId && (
                    <select
                      value={quickWorkspaceId}
                      onChange={(e) => setQuickWorkspaceId(e.target.value)}
                      required
                      className="text-[10px] px-1.5 py-1 rounded bg-transparent outline-none flex-1 truncate"
                      style={{ border: '1px solid var(--ink-border)' }}
                    >
                      <option value="">Space…</option>
                      {workspaces.map((ws) => (
                        <option key={ws.id} value={ws.id}>{ws.name}</option>
                      ))}
                    </select>
                  )}
                  <button
                    type="submit"
                    disabled={quickCreating || !quickTitle.trim() || (!workspaceId && !quickWorkspaceId)}
                    className="text-[10px] px-2.5 py-1 rounded text-white disabled:opacity-40"
                    style={{ background: 'var(--ink-accent)' }}
                  >
                    {quickCreating ? '…' : 'Add'}
                  </button>
                </div>
              </form>
            )}
            {dueTasks.length === 0 ? (
              <p className="text-[11px] py-2 text-center" style={{ color: 'var(--ink-text-muted)', opacity: 0.5 }}>Nothing due</p>
            ) : (
              <div className="space-y-px">
                {dueTasks.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 py-1.5 transition-colors duration-100"
                    style={{ borderBottom: '1px solid color-mix(in srgb, var(--ink-border) 25%, transparent)' }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: priorityColor(t.priority) }} />
                    <span className="text-xs flex-1 truncate" style={{
                      textDecoration: t.status === 'done' ? 'line-through' : 'none',
                      color: t.status === 'done' ? 'var(--ink-text-muted)' : 'var(--ink-text)',
                    }}>
                      {t.title}
                    </span>
                    {!workspaceId && (t as any).workspaceName && (
                      <span className="text-[8px] px-1 py-px rounded shrink-0" style={{ background: 'var(--ink-subtle)', color: 'var(--ink-text-muted)' }}>
                        {(t as any).workspaceName}
                      </span>
                    )}
                    {(t as any).openDays > 0 && (
                      <span className="text-[9px] shrink-0" style={{ color: 'var(--ink-text-muted)' }}>{(t as any).openDays}d</span>
                    )}
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0" style={{
                      background: t.status === 'done' ? 'var(--ink-done)' : t.status === 'blocked' ? 'var(--ink-blocked)' : 'var(--ink-pending)',
                      color: 'var(--ink-on-accent)', opacity: 0.85,
                    }}>
                      {statusLabel(t.status)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {overdueTasks.length > 0 && (
              <div className="mt-3 pt-2" style={{ borderTop: '1px solid color-mix(in srgb, var(--ink-border) 30%, transparent)' }}>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--ink-blocked)' }}>
                  Carried over ({overdueTasks.length})
                </p>
                <div className="space-y-0.5">
                  {overdueTasks.slice(0, 5).map((t) => (
                    <p key={t.id} className="text-[11px] truncate" style={{ color: 'var(--ink-blocked)' }}>{t.title}</p>
                  ))}
                  {overdueTasks.length > 5 && (
                    <p className="text-[10px]" style={{ color: 'var(--ink-text-muted)' }}>+{overdueTasks.length - 5} more</p>
                  )}
                </div>
              </div>
            )}
          </PlannerCard>
        );

      case 'notes':
        return (
          <PlannerCard>
            <CardLabel>Notes</CardLabel>
            <textarea
              value={planNotes}
              onChange={(e) => updatePlanNotes(e.target.value)}
              placeholder="Thoughts, reminders, context..."
              className="w-full text-xs leading-relaxed py-1 bg-transparent outline-none resize-none flex-1 transition-colors duration-100"
              style={{
                backgroundImage: 'repeating-linear-gradient(transparent, transparent 19px, color-mix(in srgb, var(--ink-border) 20%, transparent) 19px, color-mix(in srgb, var(--ink-border) 20%, transparent) 20px)',
                backgroundSize: '100% 20px',
                lineHeight: '20px',
              }}
            />
          </PlannerCard>
        );

      case 'reflection':
        return (
          <PlannerCard>
            <CardLabel>Reflection</CardLabel>
            <textarea
              value={reflection}
              onChange={(e) => updateReflection(e.target.value)}
              placeholder="What went well? What could improve?"
              className="w-full text-xs leading-relaxed py-1 bg-transparent outline-none resize-none flex-1 transition-colors duration-100"
              style={{
                backgroundImage: 'repeating-linear-gradient(transparent, transparent 19px, color-mix(in srgb, var(--ink-border) 20%, transparent) 19px, color-mix(in srgb, var(--ink-border) 20%, transparent) 20px)',
                backgroundSize: '100% 20px',
                lineHeight: '20px',
              }}
            />
          </PlannerCard>
        );

      case 'tomorrow':
        return (
          <PlannerCard>
            <CardLabel>Tomorrow</CardLabel>
            <textarea
              value={tomorrowNotes}
              onChange={(e) => updateTomorrowNotes(e.target.value)}
              placeholder="What to carry forward, prep for tomorrow..."
              className="w-full text-xs leading-relaxed py-1 bg-transparent outline-none resize-none flex-1 transition-colors duration-100"
              style={{
                backgroundImage: 'repeating-linear-gradient(transparent, transparent 19px, color-mix(in srgb, var(--ink-border) 20%, transparent) 19px, color-mix(in srgb, var(--ink-border) 20%, transparent) 20px)',
                backgroundSize: '100% 20px',
                lineHeight: '20px',
              }}
            />
          </PlannerCard>
        );

      case 'today-plan':
        return (
          <PlannerCard>
            <TodayPlanWidget
              blocks={plan?.planBlocks ?? null}
              date={selectedDate}
              onRebuild={() => setShowAIPlanner(true)}
              goals={goals}
            />
          </PlannerCard>
        );

      default:
        return null;
    }
  }

  return (
    <>
      {/* ═══ Paper Planner Canvas ═══ */}
      <div
        className="flex-1 flex flex-col p-4 lg:p-5 md:overflow-hidden overflow-y-auto"
        style={{ background: 'var(--ink-planner-bg)' }}
      >
        {/* ── Navigation Bar ── */}
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => router.push(workspaceId ? `/workspaces/${workspaceId}` : '/workspaces')}
            className="z-btn z-btn-ghost z-btn-sm"
            style={{ color: 'var(--ink-accent)' }}
          >
            {workspaceId ? 'Intentions' : 'Studio'}
          </button>
          {workspaceName && (
            <span className="text-xs font-medium" style={{ color: 'var(--ink-text-secondary)' }}>
              {workspaceName}
            </span>
          )}
          {workspaceId && (
            <button
              onClick={() => router.push('/planner')}
              className="z-btn z-btn-ghost z-btn-sm"
              style={{ color: 'var(--ink-text-faint)' }}
            >
              Global Planner
            </button>
          )}
        </div>

        {/* ── Date Header Strip ── */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-baseline gap-3">
            <h1 className="z-page-title">
              {selectedLabel}
            </h1>
            {!isToday && (
              <button
                onClick={() => handleSelectDate(isoDate(new Date()))}
                className="z-btn z-btn-sm"
                style={{ color: 'var(--ink-accent)', borderColor: 'var(--ink-accent)' }}
              >
                today
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 text-[10px]" style={{ color: 'var(--ink-text-muted)' }}>
              <span className="px-2 py-0.5 rounded-full" style={{ background: 'var(--ink-subtle)' }}>
                {appointments.length} appt{appointments.length !== 1 ? 's' : ''}
              </span>
              <span className="px-2 py-0.5 rounded-full" style={{ background: 'var(--ink-subtle)' }}>
                {goalsCompleted}/{goals.length} goals
              </span>
              <span className="px-2 py-0.5 rounded-full" style={{ background: 'var(--ink-subtle)' }}>
                {dueTasks.length} due
              </span>
              {overdueTasks.length > 0 && (
                <span className="px-2 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--ink-blocked) 15%, transparent)', color: 'var(--ink-blocked)' }}>
                  {overdueTasks.length} carried over
                </span>
              )}
            </div>
            {saveStatus !== 'idle' && (
              <span
                className="text-[10px] px-2 py-0.5 rounded-full transition-opacity duration-300"
                style={{
                  color: 'var(--ink-text-muted)',
                  background: 'var(--ink-subtle)',
                  opacity: saveStatus === 'saved' ? 0.7 : 1,
                }}
              >
                {saveStatus === 'saving' ? 'Saving…' : 'Saved'}
              </span>
            )}
          </div>
        </div>

        {/* ═══ Layout Controls ═══ */}
        <div className="flex items-center justify-end gap-2 mb-3 shrink-0">
          <button
            onClick={() => setShowAIPlanner(true)}
            className="z-btn z-btn-sm"
            style={{ color: 'var(--ink-accent)', borderColor: 'color-mix(in srgb, var(--ink-accent) 30%, transparent)', background: 'color-mix(in srgb, var(--ink-accent) 8%, transparent)' }}
          >
            Shape flow with AI
          </button>
          <button
            onClick={() => setEditingLayout(!editingLayout)}
            className={`hidden md:inline-flex ${editingLayout ? 'z-btn z-btn-primary z-btn-sm' : 'z-btn z-btn-ghost z-btn-sm'}`}
          >
            {editingLayout ? 'Done' : 'Edit Layout'}
          </button>
        </div>

        {/* ═══ Zone-Based Planner ═══ */}
        {/* Desktop: layout editor or zone layout */}
        {editingLayout ? (
          <div className="hidden md:block flex-1 min-h-0">
            <LayoutEditor
              layout={layout}
              onChange={setLayout}
              onDone={() => setEditingLayout(false)}
              onReset={resetLayout}
              renderWidget={renderWidget}
            />
          </div>
        ) : (
          <div className="hidden md:flex flex-1 min-h-0" style={{ gap: '14px' }}>
            {layout.columns.map((col) => (
              <div
                key={col.id}
                className="flex flex-col min-w-0 min-h-0"
                style={{ width: `${col.width * 100}%`, gap: '12px' }}
              >
                {col.zones.map((zone) => (
                  <div
                    key={zone.id}
                    className="min-h-0 overflow-y-auto rounded-lg"
                    style={{ flex: zone.height }}
                  >
                    {zone.widget && renderWidget(zone.widget)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Mobile: always stacked single column */}
        <div className="md:hidden space-y-3">
          {layout.columns
            .flatMap((c) => c.zones)
            .filter((z) => z.widget)
            .map((zone) => (
              <div key={zone.id}>{renderWidget(zone.widget!)}</div>
            ))}
        </div>
      </div>

      {/* AI Calendar Extract modal */}
      {showAIExtract && (
        <AICalendarExtractModal
          date={selectedDate}
          onClose={() => setShowAIExtract(false)}
          onImported={() => {
            setShowAIExtract(false);
            loadAppointments();
            loadCalendarSummary();
          }}
        />
      )}

      {/* AI Planner modal */}
      {showAIPlanner && (
        <AIPlannerModal
          date={selectedDate}
          onClose={() => setShowAIPlanner(false)}
          onApplied={() => {
            setShowAIPlanner(false);
            loadPlannerData();
          }}
        />
      )}

      {/* Appointment form modal */}
      {showApptForm && (
        <AppointmentForm
          date={selectedDate}
          appointment={editingAppt}
          onSaved={() => {
            setShowApptForm(false);
            setEditingAppt(null);
            loadAppointments();
            loadCalendarSummary();
          }}
          onCancel={() => { setShowApptForm(false); setEditingAppt(null); }}
        />
      )}
    </>
  );
}
