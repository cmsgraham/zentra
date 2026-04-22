export type WorkspaceRole = 'owner' | 'admin' | 'member';

export interface Workspace {
  id: string;
  name: string;
  role: WorkspaceRole;
  createdAt: string;
}

export interface WorkspaceMember {
  user: { id: string; email: string; name: string };
  role: WorkspaceRole;
}

export interface Tag {
  id: string;
  workspaceId: string;
  name: string;
}

export interface WorkspaceInvite {
  email: string;
  role: WorkspaceRole;
  status: 'pending' | 'accepted' | 'expired';
}

export interface CreateWorkspaceRequest {
  name: string;
}

export interface InviteMemberRequest {
  email: string;
  role: WorkspaceRole;
}

export interface AcceptInviteRequest {
  token: string;
}

export interface CreateTagRequest {
  name: string;
}
