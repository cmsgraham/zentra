// Local Huddle types for the web app — matches the shared types but kept inline
// to avoid cross-package import friction. Mirrors packages/shared/src/types/huddle.ts.

export type HuddleType = 'team' | 'personal';
export type HuddleStatus = 'draft' | 'active' | 'closed';
export type HuddleParticipantRole = 'host' | 'participant';
export type HuddleAttendanceStatus = 'invited' | 'present' | 'late' | 'virtual' | 'excused';
export type HuddleTopicStatus = 'open' | 'decided' | 'parked';
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
  details: string | null;
  linkedTaskId: string | null;
  status: HuddleIntentionStatus;
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
