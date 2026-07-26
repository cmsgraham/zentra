// Local Huddle types for the web app — matches the shared types but kept inline
// to avoid cross-package import friction. Mirrors packages/shared/src/types/huddle.ts.

export type HuddleType = 'team' | 'personal';
export type HuddleStatus = 'draft' | 'active' | 'closed';
export type HuddleParticipantRole = 'host' | 'participant';
export type HuddleAttendanceStatus = 'invited' | 'present' | 'late' | 'virtual' | 'excused';
// A topic's lifecycle now spans meetings, so the state is named rather than
// carried as an "open + reason" pair.
export type HuddleTopicStatus =
  | 'proposed' | 'scheduled' | 'in_discussion'
  | 'awaiting_decision' | 'deferred' | 'closed' | 'cancelled';
export const TOPIC_LIVE_STATUSES: HuddleTopicStatus[] =
  ['proposed', 'scheduled', 'in_discussion', 'awaiting_decision', 'deferred'];
export type HuddleTopicPurpose = 'decide' | 'discuss' | 'inform';
// short_term rides the weekly loop; long_term is out of the rotation.
export type HuddleTopicHorizon = 'short_term' | 'long_term';
export type HuddleIntentionStatus = 'open' | 'done' | 'cancelled';
export type HuddleFollowupStatus = 'open' | 'done' | 'carried_forward';

export interface Huddle {
  id: string;
  workspaceId: string | null;
  type: HuddleType;
  title: string;
  intention: string | null;
  hostUserId: string;
  hostName?: string | null;
  status: HuddleStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  summary: string | null;
  templateId: string | null;
  templateName?: string | null;
  emailSummaryOnClose?: boolean;
  summaryEmailedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  participantCount?: number;
}

export interface HuddleParticipant {
  id: string;
  huddleId: string;
  userId: string | null;
  role: HuddleParticipantRole;
  attendanceStatus: HuddleAttendanceStatus;
  checkedInAt: string | null;
  userName?: string;
  userEmail?: string;
  userAvatarUrl?: string | null;
  externalName?: string | null;
  externalEmail?: string | null;
}

export interface HuddleSignal {
  id: string;
  huddleId: string;
  authorUserId: string;
  text: string;
  whyItMatters: string | null;
  details: string | null;
  promotedToTopic: boolean;
  sortOrder: number;
  createdAt: string;
  authorName?: string;
}

export interface HuddleDecision {
  id: string;
  huddleTopicId: string;
  ownerUserId: string | null;
  decisionText: string;
  details: string | null;
  createdAt: string;
  ownerName?: string | null;
}

export interface HuddleTopic {
  id: string;
  huddleId: string;
  title: string;
  context: string | null;
  details: string | null;
  sortOrder: number;
  status: HuddleTopicStatus;
  purpose: HuddleTopicPurpose;
  framingQuestion: string | null;
  timeboxMinutes: number | null;
  outcome: string | null;
  outcomeState: string | null;
  firstDiscussedAt: string | null;
  agendaItemId: string | null;
  originHuddleId?: string | null;
  horizon: HuddleTopicHorizon;
  deferCount: number;
  ownerUserId: string | null;
  ownerName: string | null;
  approverUserId: string | null;
  approverName: string | null;
  parentTopicId: string | null;
  carriedFromTopicId: string | null;
  closedAt: string | null;
  closedByUserId: string | null;
  sourceSignalId: string | null;
  createdAt: string;
  decisions?: HuddleDecision[];
}

export interface HuddleIntention {
  id: string;
  huddleId: string;
  text: string;
  ownerUserId: string;
  softDueText: string | null;
  dueDate: string | null;
  topicId: string | null;
  details: string | null;
  linkedTaskId: string | null;
  // Live state of the linked task — the huddle references it rather than
  // holding a second copy that can drift.
  linkedTaskStatus: string | null;
  linkedTaskDueDate: string | null;
  status: HuddleIntentionStatus;
  sortOrder: number;
  createdAt: string;
  ownerName?: string;
}

export interface HuddleFollowup {
  id: string;
  huddleId: string;
  text: string;
  ownerUserId: string;
  reviewDate: string | null;
  status: HuddleFollowupStatus;
  carriedFromHuddleId: string | null;
  createdAt: string;
  ownerName?: string;
}

export interface HuddleNote {
  id: string;
  huddleId: string;
  authorUserId: string;
  text: string;
  createdAt: string;
  authorName?: string;
}

export interface HuddleDetail extends Huddle {
  participants: HuddleParticipant[];
  signals: HuddleSignal[];
  topics: HuddleTopic[];
  intentions: HuddleIntention[];
  followups: HuddleFollowup[];
  notes: HuddleNote[];
}
