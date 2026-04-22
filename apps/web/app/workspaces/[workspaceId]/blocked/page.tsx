'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import AuthShell from '@/components/layout/AuthShell';
import WorkspaceSidebar from '@/components/layout/WorkspaceSidebar';
import TaskCard, { type TaskData } from '@/components/tasks/TaskCard';
import TaskDetailDrawer from '@/components/tasks/TaskDetailDrawer';
import { useIsMobile } from '@/lib/useIsMobile';
import { api } from '@/lib/api-client';

export default function BlockedPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const isMobile = useIsMobile();
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    const data = await api<{ items: TaskData[] }>(`/workspaces/${workspaceId}/tasks?status=blocked&limit=200`);
    setTasks(data.items);
  }, [workspaceId]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  return (
    <AuthShell>
      <div className="flex flex-1 h-[calc(100vh-57px)]">
        {!isMobile && <WorkspaceSidebar workspaceId={workspaceId} />}
        <div className="flex-1 overflow-y-auto p-6">
          <h2 className="text-xl font-bold mb-4">Waiting on…</h2>
          {tasks.length === 0 ? (
            <p className="text-center py-16" style={{ color: 'var(--ink-text-muted)' }}>Nothing waiting — nice!</p>
          ) : (
            <div className="grid gap-3 max-w-2xl">
              {tasks.map((t) => (
                <TaskCard key={t.id} task={t} onClick={() => setSelectedTaskId(t.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
      {selectedTaskId && (
        <TaskDetailDrawer
          taskId={selectedTaskId}
          workspaceId={workspaceId}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={loadTasks}
        />
      )}
    </AuthShell>
  );
}
