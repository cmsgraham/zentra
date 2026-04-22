export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Task {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  blockedReason: string | null;
  assignee: { id: string; email: string; name: string } | null;
  creatorId: string;
  laneOrder: number | null;
  sourceType: string | null;
  sourceReferenceId: string | null;
  dueDate: string | null;
  estimatedMinutes: number | null;
  tags: string[];
  archived: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskRequest {
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  blockedReason?: string;
  assigneeId?: string;
  dueDate?: string;
  laneOrder?: number;
  tags?: string[];
  estimatedMinutes?: number;
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  blockedReason?: string;
  assigneeId?: string;
  dueDate?: string;
  laneOrder?: number;
  tags?: string[];
  archived?: boolean;
  estimatedMinutes?: number | null;
}

export interface MoveTaskRequest {
  status: TaskStatus;
  blockedReason?: string;
  laneOrder?: number;
}

export interface TaskComment {
  id: string;
  taskId: string;
  author: { id: string; email: string; name: string };
  body: string;
  createdAt: string;
}

export interface TaskActivity {
  id: string;
  taskId: string;
  actorId: string | null;
  actionType: string;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateCommentRequest {
  body: string;
}
