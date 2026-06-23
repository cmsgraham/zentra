'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors, type DragStartEvent, type DragEndEvent } from '@dnd-kit/core';
import AuthShell from '@/components/layout/AuthShell';
import WorkspaceSidebar from '@/components/layout/WorkspaceSidebar';
import BoardLane from '@/components/board/BoardLane';
import CreateTaskForm from '@/components/board/CreateTaskForm';
import TaskDetailDrawer from '@/components/tasks/TaskDetailDrawer';
import TaskCard from '@/components/tasks/TaskCard';
import BulkEditModal from '@/components/tasks/BulkEditModal';
import FloatingActionButton from '@/components/mobile/FloatingActionButton';
import WorkspaceMembersModal from '@/components/board/WorkspaceMembersModal';
import { useIsMobile } from '@/lib/useIsMobile';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import type { TaskData } from '@/components/tasks/TaskCard';

const lanes = [
  { status: 'pending', title: 'Open', color: '#fdcb6e' },
  { status: 'in_progress', title: 'Present', color: '#74b9ff' },
  { status: 'blocked', title: 'Waiting on…', color: '#e17055' },
  { status: 'done', title: 'I did it!', color: '#00b894' },
];

interface Member {
  id: string;
  name: string;
}

export default function WorkspaceBoardPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<TaskData | null>(null);
  const [collapsedLanes, setCollapsedLanes] = useState<Record<string, boolean>>({});
  const [showMembers, setShowMembers] = useState(false);

  // Multi-select state for bulk editing
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [addingToDate, setAddingToDate] = useState(false);
  const [dateToast, setDateToast] = useState<string | null>(null);
  // Default the picker to today (user's local calendar). Most adds target
  // today's plan; users can still pick tomorrow or any other date.
  const [targetDate, setTargetDate] = useState<string>(() => {
    return new Date().toLocaleDateString('en-CA');
  });
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Search / filter state
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  const toggleSelect = useCallback((taskId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  /**
   * Take the currently-selected tasks and add them as goals on the user-chosen
   * date's plan. Mirrors the add-task-as-goal flow in PlannerView: ensure a
   * plan exists for the date via PUT /planner, then POST each task to
   * /planner/:id/goals with a `linkedTaskId` so the planner UI can render them
   * as linked intentions.
   */
  const addSelectedToDate = useCallback(async (date: string) => {
    if (selectedIds.size === 0 || addingToDate || !date) return;
    const ids = Array.from(selectedIds);
    setAddingToDate(true);
    try {
      const planRes = await api<{ plan: { id: string } }>('/planner', {
        method: 'PUT',
        body: { date },
      });
      const planId = planRes.plan.id;
      // Fetch the plan's existing goals so we can pick a stable sortOrder and
      // skip tasks that are already linked (avoids accidental duplicates if
      // the user selects and hits the button twice).
      const existing = await api<{ goals: { linkedTaskId: string | null }[] }>(
        `/planner?date=${date}`,
      ).catch(() => ({ goals: [] as { linkedTaskId: string | null }[] }));
      const existingLinked = new Set(
        (existing.goals ?? [])
          .map((g) => g.linkedTaskId)
          .filter((v): v is string => typeof v === 'string'),
      );
      let sortOrder = existing.goals?.length ?? 0;
      let added = 0;
      for (const id of ids) {
        if (existingLinked.has(id)) continue;
        const task = tasks.find((t) => t.id === id);
        if (!task) continue;
        await api(`/planner/${planId}/goals`, {
          method: 'POST',
          body: {
            title: task.title,
            linkedTaskId: task.id,
            sortOrder: sortOrder++,
            // Keep tasks as Open — they shouldn't flip to Present
            // (in_progress) until the user actually starts.
            skipAutoStart: true,
          },
        });
        added++;
      }
      const skipped = ids.length - added;
      const msg = added === 0
        ? `Already on ${date}`
        : skipped > 0
          ? `Added ${added} to ${date} · ${skipped} already there`
          : `Added ${added} to ${date}`;
      setDateToast(msg);
      setTimeout(() => setDateToast(null), 2500);
      setShowDatePicker(false);
      exitSelection();
    } catch {
      setDateToast("Couldn't add to that date");
      setTimeout(() => setDateToast(null), 2500);
    } finally {
      setAddingToDate(false);
    }
  }, [selectedIds, addingToDate, tasks, exitSelection]);

  // Blocked-reason prompt state
  const [pendingDrop, setPendingDrop] = useState<{ taskIds: string[]; status: string } | null>(null);
  const [blockedReason, setBlockedReason] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const loadTasks = useCallback(async () => {
    const data = await api<{ items: TaskData[] }>(`/workspaces/${workspaceId}/tasks?limit=200&archived=false`);
    setTasks(data.items);
  }, [workspaceId]);

  const loadMembers = useCallback(async () => {
    const data = await api<{ items: { user: { id: string; email: string; name: string }; role: string }[] }>(`/workspaces/${workspaceId}/members?limit=100`);
    setMembers(data.items.map(m => ({ id: m.user.id, name: m.user.name })));
  }, [workspaceId]);

  const loadWorkspaces = useCallback(async () => {
    const data = await api<{ items: { id: string; name: string }[] }>('/workspaces?limit=50');
    setWorkspaces(data.items);
  }, []);

  useEffect(() => {
    loadTasks();
    loadMembers();
    loadWorkspaces();
  }, [loadTasks, loadMembers, loadWorkspaces]);

  const tasksByStatus = (status: string) => sortByLane(tasks.filter((t) => t.status === status));

  // Apply search + filters before grouping by status
  const filteredTasks = tasks.filter((t) => {
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${t.title} ${t.description ?? ''} ${(t.tags ?? []).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (priorityFilter && t.priority !== priorityFilter) return false;
    if (assigneeFilter) {
      if (assigneeFilter === '__unassigned__') { if (t.assignee) return false; }
      else if (t.assignee?.id !== assigneeFilter) return false;
    }
    return true;
  });
  const filteredByStatus = (status: string) => sortByLane(filteredTasks.filter((t) => t.status === status));
  const hasActiveFilters = !!(search.trim() || priorityFilter || assigneeFilter);

  // While actively dragging a multi-selected card, dim its siblings (not the
  // actively-dragged card itself — dnd-kit already dims that one).
  const dimmedIds: Set<string> | undefined = (() => {
    if (!activeTask || !selectionMode) return undefined;
    if (!selectedIds.has(activeTask.id) || selectedIds.size <= 1) return undefined;
    const s = new Set(selectedIds);
    s.delete(activeTask.id);
    return s;
  })();

  function handleDragStart(event: DragStartEvent) {
    const task = (event.active.data.current as { task: TaskData })?.task;
    setActiveTask(task ?? null);
    // If the dragged task isn't part of the current selection, treat drag as
    // a single-task drag (don't also move unrelated selected items).
    if (selectionMode && task && !selectedIds.has(task.id)) {
      // Leave the selection alone; handleDragEnd will fall back to single-task move.
    }
  }

  async function moveTask(taskId: string, newStatus: string, extra?: Record<string, unknown>) {
    // Optimistic update
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: newStatus, ...(extra as Partial<TaskData>) } : t)));
    try {
      await api(`/tasks/${taskId}`, { method: 'PATCH', body: { status: newStatus, ...extra } });
    } catch {
      // Revert on error
      await loadTasks();
    }
  }

  async function moveTasksBulk(taskIds: string[], newStatus: string, extra?: Record<string, unknown>) {
    if (taskIds.length === 0) return;
    if (taskIds.length === 1) return moveTask(taskIds[0], newStatus, extra);

    const idSet = new Set(taskIds);
    // Optimistic update across the selection
    setTasks((prev) => prev.map((t) => (idSet.has(t.id) ? { ...t, status: newStatus, ...(extra as Partial<TaskData>) } : t)));
    try {
      await api('/tasks/bulk', {
        method: 'PATCH',
        body: { taskIds, updates: { status: newStatus, ...(extra || {}) } },
      });
    } catch {
      await loadTasks();
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const draggedId = active.id as string;
    const overId = String(over.id);
    const dragged = tasks.find((t) => t.id === draggedId);
    if (!dragged) return;

    // If hovering over another task card, target = that task's lane.
    // Otherwise target = a lane droppable (id === status string).
    const overTask = overId !== draggedId ? tasks.find((t) => t.id === overId) : null;
    const newStatus = overTask ? overTask.status : overId;
    const isStatusTarget = !overTask && lanes.some((l) => l.status === newStatus);
    if (!overTask && !isStatusTarget) return;

    const isMulti = selectionMode && selectedIds.has(draggedId) && selectedIds.size > 1;

    // ── Multi-drag: keep existing bulk-status behaviour, no reorder. ──
    if (isMulti) {
      const dragIds = Array.from(selectedIds);
      const idsToMove = dragIds.filter((id) => {
        const t = tasks.find((x) => x.id === id);
        return t && t.status !== newStatus;
      });
      if (idsToMove.length === 0) return;
      if (newStatus === 'blocked') {
        setPendingDrop({ taskIds: idsToMove, status: newStatus });
        setBlockedReason('');
        return;
      }
      moveTasksBulk(idsToMove, newStatus);
      exitSelection();
      return;
    }

    // ── Single-task drag: support intra-lane reorder + cross-lane drop with position. ──
    const statusChanged = dragged.status !== newStatus;

    // Build the new lane ordering (target status), then renormalize lane_order
    // for every card so the persisted order matches the visual indicator
    // — even when neighbours had null lane_order initially.
    const reorderedIds = computeReorderedLane(dragged, newStatus, overTask?.id);
    if (!reorderedIds) return; // no-op

    if (statusChanged && newStatus === 'blocked') {
      setPendingDrop({ taskIds: [draggedId], status: newStatus });
      setBlockedReason('');
      return;
    }

    reorderLane(draggedId, newStatus, reorderedIds);
  }

  /**
   * Persist a lane reorder. Optimistically updates state, then PATCHes the
   * dragged task (status + new lane_order) plus any siblings whose lane_order
   * needs to change to keep the lane stable across reloads.
   */
  async function reorderLane(
    draggedId: string,
    newStatus: string,
    reorderedIds: string[],
  ) {
    const SPACING = 1024;
    const updates = reorderedIds.map((id, idx) => ({ id, laneOrder: (idx + 1) * SPACING }));

    // Optimistic: apply new lane_order + status to dragged + siblings.
    setTasks((prev) =>
      prev.map((t) => {
        const u = updates.find((x) => x.id === t.id);
        if (!u) return t;
        return {
          ...t,
          laneOrder: u.laneOrder,
          status: t.id === draggedId ? newStatus : t.status,
        };
      }),
    );

    try {
      // Dragged: status + lane_order.
      await api(`/tasks/${draggedId}`, {
        method: 'PATCH',
        body: { status: newStatus, laneOrder: updates.find((u) => u.id === draggedId)!.laneOrder },
      });
      // Siblings: lane_order only.
      await Promise.all(
        updates
          .filter((u) => u.id !== draggedId)
          .map((u) =>
            api(`/tasks/${u.id}`, { method: 'PATCH', body: { laneOrder: u.laneOrder } }),
          ),
      );
    } catch {
      await loadTasks();
    }
  }

  /**
   * Sort tasks by lane_order ascending (matches the API's `ORDER BY lane_order
   * NULLS LAST, created_at DESC` so nulls/unset tasks fall to the bottom).
   */
  function sortByLane(list: TaskData[]): TaskData[] {
    return [...list].sort((a, b) => {
      const aHas = a.laneOrder !== null && a.laneOrder !== undefined;
      const bHas = b.laneOrder !== null && b.laneOrder !== undefined;
      if (aHas && bHas) return (a.laneOrder as number) - (b.laneOrder as number);
      if (aHas) return -1;
      if (bHas) return 1;
      return 0;
    });
  }

  /**
   * Compute the new sequence of task ids in the target lane after `dragged`
   * is dropped relative to `overTaskId`. Returns null when the drop is a
   * no-op (same lane, identical position).
   */
  function computeReorderedLane(
    dragged: TaskData,
    newStatus: string,
    overTaskId: string | undefined,
  ): string[] | null {
    const targetLane = sortByLane(
      tasks.filter((t) => t.status === newStatus && t.id !== dragged.id),
    );
    let insertAt = targetLane.length;
    if (overTaskId) {
      const idx = targetLane.findIndex((t) => t.id === overTaskId);
      if (idx >= 0) {
        // When dragging downward inside the same lane, insert AFTER the
        // over-card (matches the visual drop indicator below the card).
        const draggedIdx = sortByLane(
          tasks.filter((t) => t.status === newStatus),
        ).findIndex((t) => t.id === dragged.id);
        const sameLane = dragged.status === newStatus && draggedIdx >= 0;
        const dropAfter = sameLane && draggedIdx < idx;
        insertAt = dropAfter ? idx + 1 : idx;
      }
    }
    const reordered = [
      ...targetLane.slice(0, insertAt).map((t) => t.id),
      dragged.id,
      ...targetLane.slice(insertAt).map((t) => t.id),
    ];
    // No-op detection: same lane, same final order.
    if (dragged.status === newStatus) {
      const original = sortByLane(tasks.filter((t) => t.status === newStatus)).map((t) => t.id);
      if (original.length === reordered.length && original.every((id, i) => id === reordered[i])) {
        return null;
      }
    }
    return reordered;
  }

  function handleBlockedConfirm() {
    if (!pendingDrop || !blockedReason.trim()) return;
    const wasMulti = pendingDrop.taskIds.length > 1;
    moveTasksBulk(pendingDrop.taskIds, pendingDrop.status, { blockedReason: blockedReason.trim() });
    setPendingDrop(null);
    setBlockedReason('');
    if (selectionMode && wasMulti) exitSelection();
  }

  const toggleLane = (status: string) => {
    setCollapsedLanes(prev => ({ ...prev, [status]: !prev[status] }));
  };

  async function handleToggleDone(taskId: string) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const newStatus = task.status === 'done' ? 'pending' : 'done';
    await moveTask(taskId, newStatus);
  }

  const handleQuickAdd = useCallback(async (title: string) => {
    // Optimistic: append the created task directly instead of refetching the
    // entire list. Combined with the stable identity of QuickAddInput (memo'd
    // child component with its own ref), this keeps the input DOM node intact
    // across rapid-entry and lets focus stay put without any hacks.
    const created = await api<TaskData>(`/workspaces/${workspaceId}/tasks`, {
      method: 'POST',
      body: {
        title,
        status: 'pending',
        priority: user?.taskDefaultPriority || 'medium',
        complexity: user?.taskDefaultComplexity || 1,
        estimatedMinutes: user?.taskDefaultEstimatedMinutes || undefined,
        assigneeId: user?.id || undefined,
      },
    });
    setTasks((prev) => (prev.some((t) => t.id === created.id) ? prev : [...prev, created]));
  }, [workspaceId, user?.taskDefaultPriority, user?.taskDefaultComplexity, user?.taskDefaultEstimatedMinutes, user?.id]);

  return (
    <AuthShell>
      <div className={`flex flex-1 ${isMobile ? '' : 'h-[calc(100vh-52px)]'}`}>
        {!isMobile && <WorkspaceSidebar workspaceId={workspaceId} />}
        <div className="flex-1 overflow-hidden flex flex-col">
          {!isMobile && (
            <div className="flex items-center justify-between px-6 py-3.5">
              <h2 className="z-page-title">Board</h2>
              <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (selectionMode) exitSelection();
                  else setSelectionMode(true);
                }}
                className="z-btn"
                title={selectionMode ? 'Exit selection' : 'Select intentions'}
              >
                {selectionMode ? `Cancel (${selectedIds.size})` : 'Select'}
              </button>
              {selectionMode && selectedIds.size > 0 && (
                <button
                  onClick={() => setShowBulkEdit(true)}
                  className="z-btn z-btn-primary"
                  title="Edit selected intentions"
                >
                  Edit {selectedIds.size}
                </button>
              )}
              {selectionMode && selectedIds.size > 0 && (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <button
                    onClick={() => setShowDatePicker((v) => !v)}
                    disabled={addingToDate}
                    className="z-btn"
                    title="Add selected intentions as goals on a chosen date's plan"
                  >
                    {addingToDate ? 'Adding…' : `→ Add to date (${selectedIds.size})`}
                  </button>
                  {showDatePicker && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        right: 0,
                        zIndex: 30,
                        background: 'var(--ink-bg-elev)',
                        border: '1px solid var(--ink-border)',
                        borderRadius: 8,
                        padding: 8,
                        display: 'flex',
                        gap: 6,
                        alignItems: 'center',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      }}
                    >
                      <input
                        type="date"
                        value={targetDate}
                        onChange={(e) => setTargetDate(e.target.value)}
                        className="z-input"
                        style={{ fontSize: 13 }}
                      />
                      <button
                        onClick={() => addSelectedToDate(targetDate)}
                        disabled={addingToDate || !targetDate}
                        className="z-btn z-btn-primary"
                      >
                        Add
                      </button>
                    </div>
                  )}
                </div>
              )}
              {dateToast && (
                <span
                  className="text-xs"
                  style={{ color: 'var(--ink-text-muted)', paddingLeft: 4 }}
                  role="status"
                >
                  {dateToast}
                </span>
              )}
              <button
                onClick={() => setShowFilters((v) => !v)}
                className="z-btn"
                title="Search & filter"
                style={hasActiveFilters ? { borderColor: 'var(--ink-accent)', color: 'var(--ink-accent)' } : undefined}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
                {hasActiveFilters ? `Filters (${[search.trim() && 'text', priorityFilter && 'priority', assigneeFilter && 'assignee'].filter(Boolean).length})` : 'Filter'}
              </button>
              <button
                onClick={() => setShowMembers(true)}
                data-tour="share"
                data-tour-label="Share — invite collaborators to this Space"
                className="z-btn"
                title="Members"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                Share
              </button>
              <button
                onClick={() => setShowCreate(true)}
                data-tour="new-intention-button"
                data-tour-label="New Intention — full create form"
                className="z-btn z-btn-primary"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><line x1="7" y1="2" x2="7" y2="12"/><line x1="2" y1="7" x2="12" y2="7"/></svg>
                New Intention
              </button>
              </div>
            </div>
          )}
          {(showFilters || hasActiveFilters) && (
            <div className={`${isMobile ? 'px-4 pt-2 pb-2' : 'px-6 pb-3'} flex flex-wrap items-center gap-2`}>
              <div className="relative flex-1 min-w-[180px]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
                  style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-text-faint)' }}>
                  <circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search intentions by title, description, tag…"
                  className="w-full text-sm rounded-lg"
                  style={{ padding: '7px 10px 7px 30px', border: '1px solid var(--ink-border)', background: 'var(--ink-bg)', color: 'var(--ink-text)' }}
                />
              </div>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="text-sm rounded-lg"
                style={{ padding: '7px 10px', border: '1px solid var(--ink-border)', background: 'var(--ink-bg)', color: 'var(--ink-text)' }}
              >
                <option value="">All priorities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <select
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
                className="text-sm rounded-lg"
                style={{ padding: '7px 10px', border: '1px solid var(--ink-border)', background: 'var(--ink-bg)', color: 'var(--ink-text)' }}
              >
                <option value="">All assignees</option>
                <option value="__unassigned__">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              {hasActiveFilters && (
                <button
                  onClick={() => { setSearch(''); setPriorityFilter(''); setAssigneeFilter(''); }}
                  className="z-btn text-sm"
                  title="Clear filters"
                >
                  Clear
                </button>
              )}
              <span className="text-xs ml-auto" style={{ color: 'var(--ink-text-muted)' }}>
                {filteredTasks.length} of {tasks.length}
              </span>
            </div>
          )}
          {isMobile ? (
            /* Mobile: vertical stacked lanes */
            <div
              className="flex-1 overflow-y-auto px-4 pb-24 pt-3"
              data-tour="workspace-board"
              data-tour-label="Board — your intentions for this Space"
            >
              <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                <div className="space-y-5" data-tour="board-states" data-tour-label="States — Open, Present, Waiting on…, I did it!">
                  {lanes.map((lane) => {
                    const laneTasks = filteredByStatus(lane.status);
                    const isCollapsed = collapsedLanes[lane.status] ?? false;
                    return (
                      <div key={lane.status}>
                        <button
                          onClick={() => toggleLane(lane.status)}
                          className="flex items-center gap-2 w-full py-2 px-1"
                        >
                          <div className="w-1.5 h-1.5 rounded-full" style={{ background: lane.color, opacity: 0.7 }} />
                          <h3 className="z-section-title">
                            {lane.title}
                          </h3>
                          <span className="text-[11px]" style={{ color: 'var(--ink-text-faint)' }}>
                            {laneTasks.length}
                          </span>
                          <svg
                            className="ml-auto w-3.5 h-3.5 transition-transform"
                            style={{ color: 'var(--ink-text-faint)', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {!isCollapsed && (
                          <BoardLane
                            title={lane.title}
                            status={lane.status}
                            color={lane.color}
                            tasks={laneTasks}
                            onTaskClick={setSelectedTaskId}
                            onToggleDone={handleToggleDone}
                            onQuickAdd={lane.status === 'pending' ? handleQuickAdd : undefined}
                            onToggleSelect={selectionMode ? toggleSelect : undefined}
                            selectedIds={selectionMode ? selectedIds : undefined}
                            dimmedIds={dimmedIds}
                            mobile
                            resizeStorageKey={`zentra:lane-h:${workspaceId}:${lane.status}`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                <DragOverlay>
                  {activeTask ? (
                    <div style={{ position: 'relative' }}>
                      <TaskCard task={activeTask} isDragOverlay />
                      {selectionMode && selectedIds.has(activeTask.id) && selectedIds.size > 1 && (
                        <span
                          style={{
                            position: 'absolute', top: -8, right: -8,
                            background: 'var(--ink-accent, #3b82f6)', color: 'white',
                            borderRadius: '999px', padding: '2px 8px',
                            fontSize: '0.75rem', fontWeight: 600,
                            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                          }}
                        >
                          {selectedIds.size}
                        </span>
                      )}
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </div>
          ) : (
            /* Desktop: horizontal lanes */
            <div
              className="flex-1 overflow-x-auto px-5 pb-5"
              data-tour="workspace-board"
              data-tour-label="Board — your intentions for this Space"
            >
              <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                <div
                  className="flex gap-5 h-full"
                  data-tour="board-states"
                  data-tour-label="States — Open, Present, Waiting on…, I did it!"
                >
                  {lanes.map((lane) => (
                    <BoardLane
                      key={lane.status}
                      title={lane.title}
                      status={lane.status}
                      color={lane.color}
                      tasks={filteredByStatus(lane.status)}
                      onTaskClick={setSelectedTaskId}
                      onToggleDone={handleToggleDone}
                      onQuickAdd={lane.status === 'pending' ? handleQuickAdd : undefined}
                      onToggleSelect={selectionMode ? toggleSelect : undefined}
                      selectedIds={selectionMode ? selectedIds : undefined}
                      dimmedIds={dimmedIds}
                    />
                  ))}
                </div>
                <DragOverlay>
                  {activeTask ? (
                    <div style={{ position: 'relative' }}>
                      <TaskCard task={activeTask} isDragOverlay />
                      {selectionMode && selectedIds.has(activeTask.id) && selectedIds.size > 1 && (
                        <span
                          style={{
                            position: 'absolute', top: -8, right: -8,
                            background: 'var(--ink-accent, #3b82f6)', color: 'white',
                            borderRadius: '999px', padding: '2px 8px',
                            fontSize: '0.75rem', fontWeight: 600,
                            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                          }}
                        >
                          {selectedIds.size}
                        </span>
                      )}
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </div>
          )}
        </div>
      </div>

      {isMobile && (
        <FloatingActionButton
          actions={[
            { label: 'New Intention', icon: '+', onClick: () => setShowCreate(true) },
            { label: 'Share', icon: '👥', onClick: () => setShowMembers(true) },
          ]}
        />
      )}

      {showCreate && (
        <CreateTaskForm
          workspaceId={workspaceId}
          onCreated={() => { setShowCreate(false); loadTasks(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {selectedTaskId && (
        <TaskDetailDrawer
          taskId={selectedTaskId}
          workspaceId={workspaceId}
          members={members}
          workspaces={workspaces}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={loadTasks}
        />
      )}

      {showMembers && (
        <WorkspaceMembersModal
          workspaceId={workspaceId}
          onClose={() => setShowMembers(false)}
        />
      )}

      {showBulkEdit && (
        <BulkEditModal
          taskIds={Array.from(selectedIds)}
          members={members}
          workspaces={workspaces}
          onClose={() => setShowBulkEdit(false)}
          onDone={() => {
            setShowBulkEdit(false);
            exitSelection();
            loadTasks();
          }}
        />
      )}

      {/* Blocked reason prompt modal */}
      {pendingDrop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center z-animate-fade" style={{ background: 'var(--ink-overlay)' }} onClick={() => setPendingDrop(null)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); handleBlockedConfirm(); }}
            className="w-full max-w-sm p-6 space-y-4 z-overlay z-animate-in"
          >
            <h2 className="text-base font-semibold">
              {pendingDrop.taskIds.length > 1
                ? `Why are these ${pendingDrop.taskIds.length} intentions blocked?`
                : 'Why is this intention blocked?'}
            </h2>
            <input
              value={blockedReason}
              onChange={(e) => setBlockedReason(e.target.value)}
              placeholder={
                pendingDrop.taskIds.length > 1
                  ? 'Same reason will apply to all…'
                  : "Describe what's blocking this intention…"
              }
              required
              autoFocus
              className="z-input"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setPendingDrop(null)} className="z-btn">Cancel</button>
              <button type="submit" className="z-btn" style={{ background: 'var(--ink-blocked)', color: 'white', borderColor: 'var(--ink-blocked)' }}>Confirm</button>
            </div>
          </form>
        </div>
      )}
    </AuthShell>
  );
}
