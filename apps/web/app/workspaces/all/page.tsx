'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors, type DragStartEvent, type DragEndEvent } from '@dnd-kit/core';
import AuthShell from '@/components/layout/AuthShell';
import WorkspaceSidebar from '@/components/layout/WorkspaceSidebar';
import BoardLane from '@/components/board/BoardLane';
import TaskDetailDrawer from '@/components/tasks/TaskDetailDrawer';
import TaskCard from '@/components/tasks/TaskCard';
import BulkEditModal from '@/components/tasks/BulkEditModal';
import { useIsMobile } from '@/lib/useIsMobile';
import { api } from '@/lib/api-client';
import type { TaskData } from '@/components/tasks/TaskCard';

const lanes = [
  { status: 'pending', title: 'Open', color: '#fdcb6e' },
  { status: 'in_progress', title: 'Present', color: '#74b9ff' },
  { status: 'blocked', title: 'Waiting on…', color: '#e17055' },
  { status: 'done', title: 'I did it!', color: '#00b894' },
];

// Stable palette — assigned in order of the workspace list so the colour
// stays the same across renders.
const PALETTE = [
  '#6366f1', // indigo
  '#ec4899', // pink
  '#10b981', // emerald
  '#f59e0b', // amber
  '#06b6d4', // cyan
  '#ef4444', // red
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#f97316', // orange
  '#0ea5e9', // sky
];

interface Workspace {
  id: string;
  name: string;
}

export default function AllWorkspacesBoardPage() {
  const isMobile = useIsMobile();
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<TaskData | null>(null);
  const [collapsedLanes, setCollapsedLanes] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // Multi-select state (bulk edit + add-to-date)
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

  // Filters
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [workspaceFilter, setWorkspaceFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [wsData, taskData] = await Promise.all([
        api<{ items: Workspace[] }>('/workspaces?limit=50'),
        api<{ items: TaskData[] }>('/my/tasks?pageSize=100'),
      ]);
      setWorkspaces(wsData.items);
      setTasks(taskData.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Deterministic colour mapping: first 10 get the palette, the rest fall back
  // to a hashed HSL so everyone still gets a stable colour.
  const colorByWorkspace = useMemo(() => {
    const map: Record<string, string> = {};
    workspaces.forEach((w, i) => {
      if (i < PALETTE.length) {
        map[w.id] = PALETTE[i];
      } else {
        let h = 0;
        for (let j = 0; j < w.id.length; j++) h = (h * 31 + w.id.charCodeAt(j)) >>> 0;
        map[w.id] = `hsl(${h % 360}, 55%, 55%)`;
      }
    });
    return map;
  }, [workspaces]);

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

  const filteredTasks = tasks.filter((t) => {
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${t.title} ${t.description ?? ''} ${(t.tags ?? []).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (priorityFilter && t.priority !== priorityFilter) return false;
    if (workspaceFilter && t.workspaceId !== workspaceFilter) return false;
    return true;
  });
  const filteredByStatus = (status: string) => sortByLane(filteredTasks.filter((t) => t.status === status));
  const hasActiveFilters = !!(search.trim() || priorityFilter || workspaceFilter);

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
  }

  async function moveTask(taskId: string, newStatus: string, extra?: Record<string, unknown>) {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: newStatus, ...(extra as Partial<TaskData>) } : t)));
    try {
      await api(`/tasks/${taskId}`, { method: 'PATCH', body: { status: newStatus, ...extra } });
    } catch {
      await loadAll();
    }
  }

  async function moveTasksBulk(taskIds: string[], newStatus: string, extra?: Record<string, unknown>) {
    if (taskIds.length === 0) return;
    if (taskIds.length === 1) return moveTask(taskIds[0], newStatus, extra);
    const idSet = new Set(taskIds);
    setTasks((prev) => prev.map((t) => (idSet.has(t.id) ? { ...t, status: newStatus, ...(extra as Partial<TaskData>) } : t)));
    try {
      await api('/tasks/bulk', { method: 'PATCH', body: { taskIds, updates: { status: newStatus, ...(extra || {}) } } });
    } catch {
      await loadAll();
    }
  }

  // Blocked-reason prompt
  const [pendingDrop, setPendingDrop] = useState<{ taskIds: string[]; status: string } | null>(null);
  const [blockedReason, setBlockedReason] = useState('');

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const draggedId = active.id as string;
    const overId = String(over.id);
    const dragged = tasks.find((t) => t.id === draggedId);
    if (!dragged) return;

    const overTask = overId !== draggedId ? tasks.find((t) => t.id === overId) : null;
    const newStatus = overTask ? overTask.status : overId;
    const isStatusTarget = !overTask && lanes.some((l) => l.status === newStatus);
    if (!overTask && !isStatusTarget) return;

    const isMulti = selectionMode && selectedIds.has(draggedId) && selectedIds.size > 1;

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

    const statusChanged = dragged.status !== newStatus;
    const reorderedIds = computeReorderedLane(dragged, newStatus, overTask?.id);
    if (!reorderedIds) return;
    if (statusChanged && newStatus === 'blocked') {
      setPendingDrop({ taskIds: [draggedId], status: newStatus });
      setBlockedReason('');
      return;
    }
    reorderLane(draggedId, newStatus, reorderedIds);
  }

  async function reorderLane(
    draggedId: string,
    newStatus: string,
    reorderedIds: string[],
  ) {
    const SPACING = 1024;
    const updates = reorderedIds.map((id, idx) => ({ id, laneOrder: (idx + 1) * SPACING }));
    setTasks((prev) =>
      prev.map((t) => {
        const u = updates.find((x) => x.id === t.id);
        if (!u) return t;
        return { ...t, laneOrder: u.laneOrder, status: t.id === draggedId ? newStatus : t.status };
      }),
    );
    try {
      await api(`/tasks/${draggedId}`, {
        method: 'PATCH',
        body: { status: newStatus, laneOrder: updates.find((u) => u.id === draggedId)!.laneOrder },
      });
      await Promise.all(
        updates
          .filter((u) => u.id !== draggedId)
          .map((u) =>
            api(`/tasks/${u.id}`, { method: 'PATCH', body: { laneOrder: u.laneOrder } }),
          ),
      );
    } catch {
      await loadAll();
    }
  }

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

  async function handleToggleDone(taskId: string) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const newStatus = task.status === 'done' ? 'pending' : 'done';
    await moveTask(taskId, newStatus);
  }

  const toggleLane = (status: string) => {
    setCollapsedLanes((prev) => ({ ...prev, [status]: !prev[status] }));
  };

  /** Mirror of the single-workspace board: add selected tasks as goals on a chosen date. */
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

  // Drawer needs the task's own workspaceId
  const selectedTask = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) : null;
  const drawerWorkspaceId = selectedTask?.workspaceId;

  return (
    <AuthShell>
      <div className={`flex flex-1 ${isMobile ? '' : 'h-[calc(100vh-52px)]'}`}>
        {!isMobile && <WorkspaceSidebar workspaceId="all" />}
        <div className="flex-1 overflow-hidden flex flex-col">
          {!isMobile && (
            <div className="flex items-center justify-between px-6 py-3.5">
              <div className="flex items-center gap-3">
                <h2 className="z-page-title">All spaces</h2>
                <span className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
                  {filteredTasks.length} of {tasks.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (selectionMode) exitSelection();
                    else setSelectionMode(true);
                  }}
                  className="z-btn"
                >
                  {selectionMode ? `Cancel (${selectedIds.size})` : 'Select'}
                </button>
                {selectionMode && selectedIds.size > 0 && (
                  <button onClick={() => setShowBulkEdit(true)} className="z-btn z-btn-primary">
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
                  <span className="text-xs" style={{ color: 'var(--ink-text-muted)', paddingLeft: 4 }} role="status">
                    {dateToast}
                  </span>
                )}
                <button
                  onClick={() => setShowFilters((v) => !v)}
                  className="z-btn"
                  style={hasActiveFilters ? { borderColor: 'var(--ink-accent)', color: 'var(--ink-accent)' } : undefined}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
                  {hasActiveFilters ? 'Filters' : 'Filter'}
                </button>
              </div>
            </div>
          )}

          {/* Workspace legend */}
          {!isMobile && workspaces.length > 0 && (
            <div className="px-6 pb-2 flex flex-wrap items-center gap-3">
              {workspaces.map((w) => {
                const active = workspaceFilter === w.id;
                return (
                  <button
                    key={w.id}
                    onClick={() => setWorkspaceFilter(active ? '' : w.id)}
                    className="inline-flex items-center gap-1.5 text-xs"
                    style={{
                      padding: '3px 8px',
                      borderRadius: 6,
                      border: `1px solid ${active ? colorByWorkspace[w.id] : 'var(--ink-border)'}`,
                      background: active ? `${colorByWorkspace[w.id]}18` : 'transparent',
                      color: active ? 'var(--ink-text)' : 'var(--ink-text-muted)',
                    }}
                    title={active ? 'Clear filter' : `Show only ${w.name}`}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8, height: 8,
                        borderRadius: 2,
                        background: colorByWorkspace[w.id],
                      }}
                    />
                    {w.name}
                  </button>
                );
              })}
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
                  placeholder="Search intentions…"
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
                value={workspaceFilter}
                onChange={(e) => setWorkspaceFilter(e.target.value)}
                className="text-sm rounded-lg"
                style={{ padding: '7px 10px', border: '1px solid var(--ink-border)', background: 'var(--ink-bg)', color: 'var(--ink-text)' }}
              >
                <option value="">All spaces</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              {hasActiveFilters && (
                <button
                  onClick={() => { setSearch(''); setPriorityFilter(''); setWorkspaceFilter(''); }}
                  className="z-btn text-sm"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {loading && tasks.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--ink-text-muted)' }}>
              Loading…
            </div>
          ) : isMobile ? (
            <div className="flex-1 overflow-y-auto px-4 pb-24 pt-3">
              <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                <div className="space-y-5">
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
                          <h3 className="z-section-title">{lane.title}</h3>
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
                            onToggleSelect={selectionMode ? toggleSelect : undefined}
                            selectedIds={selectionMode ? selectedIds : undefined}
                            dimmedIds={dimmedIds}
                            accentColorByWorkspace={colorByWorkspace}
                            mobile
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                <DragOverlay>
                  {activeTask ? (
                    <TaskCard
                      task={activeTask}
                      isDragOverlay
                      accentColor={activeTask.workspaceId ? colorByWorkspace[activeTask.workspaceId] : undefined}
                    />
                  ) : null}
                </DragOverlay>
              </DndContext>
            </div>
          ) : (
            <div className="flex-1 overflow-x-auto px-5 pb-5">
              <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                <div className="flex gap-5 h-full">
                  {lanes.map((lane) => (
                    <BoardLane
                      key={lane.status}
                      title={lane.title}
                      status={lane.status}
                      color={lane.color}
                      tasks={filteredByStatus(lane.status)}
                      onTaskClick={setSelectedTaskId}
                      onToggleDone={handleToggleDone}
                      onToggleSelect={selectionMode ? toggleSelect : undefined}
                      selectedIds={selectionMode ? selectedIds : undefined}
                      dimmedIds={dimmedIds}
                      accentColorByWorkspace={colorByWorkspace}
                    />
                  ))}
                </div>
                <DragOverlay>
                  {activeTask ? (
                    <TaskCard
                      task={activeTask}
                      isDragOverlay
                      accentColor={activeTask.workspaceId ? colorByWorkspace[activeTask.workspaceId] : undefined}
                    />
                  ) : null}
                </DragOverlay>
              </DndContext>
            </div>
          )}
        </div>
      </div>

      {selectedTaskId && drawerWorkspaceId && (
        <TaskDetailDrawer
          taskId={selectedTaskId}
          workspaceId={drawerWorkspaceId}
          workspaces={workspaces}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={loadAll}
        />
      )}

      {showBulkEdit && (
        <BulkEditModal
          taskIds={Array.from(selectedIds)}
          workspaces={workspaces}
          onClose={() => setShowBulkEdit(false)}
          onDone={() => {
            setShowBulkEdit(false);
            exitSelection();
            loadAll();
          }}
        />
      )}

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
              placeholder={pendingDrop.taskIds.length > 1 ? 'Same reason will apply to all…' : "Describe what's blocking this intention…"}
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
