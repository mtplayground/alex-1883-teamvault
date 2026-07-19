import type { WorkspaceRole } from '../workspaces/model.js';

export function roleCanCreateProject(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'member';
}

export function roleCanEditProject(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'member';
}

export function roleCanDeleteProject(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'member';
}

export function roleCanListAllProjects(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'member';
}

export function roleCanViewProject(
  role: WorkspaceRole,
  isSharedWithUser: boolean,
): boolean {
  return roleCanListAllProjects(role) || (role === 'guest' && isSharedWithUser);
}
