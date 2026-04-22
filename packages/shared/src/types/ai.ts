import type { TaskStatus, TaskPriority } from './task.js';

export type AIJobStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type AIInputType = 'text' | 'image';

export interface AIImportJob {
  id: string;
  workspaceId: string;
  inputType: AIInputType;
  status: AIJobStatus;
  createdAt: string;
}

export interface AIImportDraftItem {
  id: string;
  originalTextSnippet: string;
  proposedTitle: string;
  proposedDescription: string | null;
  proposedStatus: TaskStatus;
  proposedPriority: TaskPriority;
  proposedDueDate: string | null;
  proposedAssigneeId: string | null;
  confidenceScore: number;
  ambiguityFlags: string[];
}

export interface AIImportJobDetail extends AIImportJob {
  items: AIImportDraftItem[];
}

export interface TaskImprovementSuggestion {
  suggestedTitle: string;
  suggestedDescription: string | null;
  suggestedPriority: TaskPriority;
  rationale: string;
  similarTaskIds: string[];
}

export interface TextImportRequest {
  text: string;
}

export interface AcceptImportItemsRequest {
  itemIds: string[];
}
