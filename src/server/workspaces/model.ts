export const workspaceRoles = ['owner', 'member', 'guest'] as const;

export type WorkspaceRole = (typeof workspaceRoles)[number];

export interface Workspace {
  id: string;
  name: string;
  createdBySub: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceMembership {
  workspaceId: string;
  userSub: string;
  role: WorkspaceRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewWorkspaceInput {
  name: string;
  createdBySub: string;
}

export interface NewMembershipInput {
  workspaceId: string;
  userSub: string;
  role: WorkspaceRole;
}

export function normalizeWorkspaceName(name: string): string {
  const normalized = name.trim();

  if (normalized.length === 0) {
    throw new Error('workspace name is required');
  }

  return normalized;
}

export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return workspaceRoles.includes(value as WorkspaceRole);
}

export function parseWorkspaceRole(value: string): WorkspaceRole {
  if (!isWorkspaceRole(value)) {
    throw new Error(`unsupported workspace role: ${value}`);
  }

  return value;
}
