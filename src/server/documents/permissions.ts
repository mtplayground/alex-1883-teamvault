import type { WorkspaceRole } from '../workspaces/model.js';

export function roleCanAccessProjectDocuments(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'member';
}

export function roleCanAccessDocument(
  role: WorkspaceRole,
  input: {
    hasProjectAccess: boolean;
    isDocumentSharedWithUser: boolean;
  },
): boolean {
  return (
    roleCanAccessProjectDocuments(role) ||
    input.hasProjectAccess ||
    input.isDocumentSharedWithUser
  );
}

export function roleCanShareDocument(
  role: WorkspaceRole,
  input: { hasProjectAccess: boolean },
): boolean {
  return roleCanAccessProjectDocuments(role) && input.hasProjectAccess;
}
