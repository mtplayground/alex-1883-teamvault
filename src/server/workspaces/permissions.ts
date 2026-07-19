import { type WorkspaceRole } from './model.js';

export const workspacePermissions = [
  'manage_workspace',
  'invite_members',
  'create_projects',
  'upload_documents',
  'view_shared_items',
  'download_shared_items',
] as const;

export type WorkspacePermission = (typeof workspacePermissions)[number];

const permissionsByRole: Record<
  WorkspaceRole,
  ReadonlySet<WorkspacePermission>
> = {
  owner: new Set(workspacePermissions),
  member: new Set([
    'create_projects',
    'upload_documents',
    'view_shared_items',
    'download_shared_items',
  ]),
  guest: new Set(['view_shared_items', 'download_shared_items']),
};

export function roleCan(
  role: WorkspaceRole,
  permission: WorkspacePermission,
): boolean {
  return permissionsByRole[role].has(permission);
}

export function permissionsForRole(role: WorkspaceRole): WorkspacePermission[] {
  return workspacePermissions.filter((permission) => roleCan(role, permission));
}

export function assertRoleCan(
  role: WorkspaceRole,
  permission: WorkspacePermission,
): void {
  if (!roleCan(role, permission)) {
    throw new Error(`${role} cannot ${permission}`);
  }
}
