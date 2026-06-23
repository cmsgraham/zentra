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
  status: HuddleStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  summary: string | null;
  emailSummaryOnClose?: boolean;
  summaryEmailedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HuddleParticipant {
  id: string;
  huddleId: string;
  userId: string;
  role: HuddleParticipantRole;
  attendanceStatus: HuddleAttendanceStatus;
  checkedInAt: string | null;
  userName?: string;
  userEmail?: string;
  userAvatarUrl?: string | null;
}

export interface HuddleSignal {
  id: string;
  huddleId: string;
  authorUserId: string;
  text: string;
  whyItMatters: string | null;
  promotedToTopic: boolean;
  createdAt: string;
  authorName?: string;
}

export interface HuddleTopic {
  id: string;
  huddleId: string;
  title: string;
  context: string | null;
  sortOrder: number;
  status: HuddleTopicStatus;
  sourceSignalId: string | null;
  createdAt: string;
  decisions?: HuddleDecision[];
}

export interface HuddleDecision {
  id: string;
  huddleTopicId: string;
  ownerUserId: string | null;
  decisionText: string;
  createdAt: string;
  ownerName?: string | null;
}

export interface HuddleIntention {
  id: string;
  huddleId: string;
  text: string;
  ownerUserId: string;
  softDueText: string | null;
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
  hostName?: string;
}

export interface HuddleTemplateTopic {
  title: string;
  context?: string | null;
}

export interface HuddleTemplate {
  id: string;
  ownerUserId: string;
  workspaceId: string | null;
  name: string;
  type: HuddleType;
  defaultTitle: string;
  defaultIntention: string | null;
  defaultParticipantUserIds: string[];
  defaultTopics: HuddleTemplateTopic[];
  emailSummaryToParticipants?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HuddleShare {
  id: string;
  huddleId: string;
  token: string;
  createdByUserId: string;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
}

export interface HuddleSharedSummary {
  huddle: {
    id: string;
    type: HuddleType;
    title: string;
    intention: string | null;
    summary: string | null;
    startedAt: string | null;
    endedAt: string | null;
    scheduledAt: string | null;
    hostName: string | null;
  };
  participants: Array<{
    name: string | null;
    role: HuddleParticipantRole;
    attendanceStatus: HuddleAttendanceStatus;
  }>;
  topics: Array<{
    id: string;
    title: string;
    context: string | null;
    status: HuddleTopicStatus;
    decisions: Array<{ decisionText: string; ownerName: string | null }>;
  }>;
  intentions: Array<{
    text: string;
    softDueText: string | null;
    status: HuddleIntentionStatus;
    ownerName: string | null;
  }>;
  followups: Array<{
    text: string;
    reviewDate: string | null;
    status: HuddleFollowupStatus;
    ownerName: string | null;
  }>;
  notes: Array<{
    text: string;
    createdAt: string;
    authorName: string | null;
  }>;
}
