import { createHash, randomBytes } from 'node:crypto';

import {
  normalizeWorkspaceName,
  parseWorkspaceInviteRole,
  parseWorkspaceRole,
  type NewWorkspaceInput,
  type Workspace,
  type WorkspaceInvitation,
  type WorkspaceInviteRole,
  type WorkspaceMembership,
  type WorkspaceRole,
} from './model.js';

export interface WorkspaceQueryable {
  query<T>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    rows: T[];
  }>;
}

interface WorkspaceRow {
  id: string;
  name: string;
  created_by_sub: string;
  created_at: Date;
  updated_at: Date;
}

interface WorkspaceMembershipRow {
  workspace_id: string;
  user_sub: string;
  role: string;
  created_at: Date;
  updated_at: Date;
}

interface WorkspaceInvitationRow {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
  token_hash: string;
  invited_by_sub: string;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

export interface WorkspaceDetails {
  workspace: Workspace;
  members: WorkspaceMembership[];
}

export interface IssueWorkspaceInvitationInput {
  workspaceId: string;
  email: string;
  role: WorkspaceInviteRole;
  invitedBySub: string;
  tokenGenerator?: InvitationTokenGenerator;
}

export interface IssueWorkspaceInvitationResult {
  invitation: WorkspaceInvitation;
  token: string;
}

export type InvitationTokenGenerator = () => string;

export class WorkspaceNotFoundError extends Error {
  constructor() {
    super('Workspace not found');
  }
}

export class WorkspacePermissionError extends Error {
  constructor(message = 'Workspace permission denied') {
    super(message);
  }
}

export async function createWorkspace(
  db: WorkspaceQueryable,
  input: NewWorkspaceInput,
): Promise<Workspace> {
  const name = normalizeWorkspaceName(input.name);
  const createdBySub = normalizeRequiredText(
    input.createdBySub,
    'createdBySub',
  );
  const result = await db.query<WorkspaceRow>(
    `
      with new_workspace as (
        insert into workspaces (name, created_by_sub)
        values ($1, $2)
        returning id, name, created_by_sub, created_at, updated_at
      ),
      owner_membership as (
        insert into workspace_memberships (workspace_id, user_sub, role)
        select id, $2, 'owner'
        from new_workspace
        returning workspace_id
      )
      select id, name, created_by_sub, created_at, updated_at
      from new_workspace
    `,
    [name, createdBySub],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Workspace creation returned no rows');
  }

  return mapWorkspaceRow(row);
}

export async function getWorkspaceDetails(
  db: WorkspaceQueryable,
  workspaceId: string,
): Promise<WorkspaceDetails> {
  const workspace = await findWorkspace(db, workspaceId);
  if (!workspace) {
    throw new WorkspaceNotFoundError();
  }

  const memberships = await db.query<WorkspaceMembershipRow>(
    `
      select workspace_id, user_sub, role, created_at, updated_at
      from workspace_memberships
      where workspace_id = $1
      order by
        case role
          when 'owner' then 1
          when 'member' then 2
          else 3
        end,
        created_at asc,
        user_sub asc
    `,
    [workspaceId],
  );

  return {
    workspace,
    members: memberships.rows.map(mapWorkspaceMembershipRow),
  };
}

export async function updateWorkspaceSettings(
  db: WorkspaceQueryable,
  workspaceId: string,
  input: { name: string },
): Promise<Workspace> {
  const name = normalizeWorkspaceName(input.name);
  const result = await db.query<WorkspaceRow>(
    `
      update workspaces
      set name = $2,
          updated_at = now()
      where id = $1
      returning id, name, created_by_sub, created_at, updated_at
    `,
    [workspaceId, name],
  );

  const row = result.rows[0];
  if (!row) {
    throw new WorkspaceNotFoundError();
  }

  return mapWorkspaceRow(row);
}

export async function getWorkspaceMembershipRole(
  db: WorkspaceQueryable,
  workspaceId: string,
  userSub: string,
): Promise<WorkspaceRole | null> {
  const result = await db.query<{ role: string }>(
    `
      select role
      from workspace_memberships
      where workspace_id = $1
        and user_sub = $2
    `,
    [workspaceId, normalizeRequiredText(userSub, 'userSub')],
  );

  const role = result.rows[0]?.role;
  return role ? parseWorkspaceRole(role) : null;
}

export async function requireWorkspaceOwner(
  db: WorkspaceQueryable,
  workspaceId: string,
  userSub: string,
): Promise<void> {
  const role = await getWorkspaceMembershipRole(db, workspaceId, userSub);

  if (role !== 'owner') {
    throw new WorkspacePermissionError('Only workspace owners can manage it');
  }
}

export async function requireWorkspaceMembership(
  db: WorkspaceQueryable,
  workspaceId: string,
  userSub: string,
): Promise<WorkspaceRole> {
  const role = await getWorkspaceMembershipRole(db, workspaceId, userSub);

  if (!role) {
    throw new WorkspacePermissionError('Workspace membership required');
  }

  return role;
}

export async function issueWorkspaceInvitation(
  db: WorkspaceQueryable,
  input: IssueWorkspaceInvitationInput,
): Promise<IssueWorkspaceInvitationResult> {
  const email = normalizeEmail(input.email);
  const role = parseWorkspaceInviteRole(input.role);
  const invitedBySub = normalizeRequiredText(
    input.invitedBySub,
    'invitedBySub',
  );
  const token = (input.tokenGenerator ?? createInvitationToken)();
  const tokenHash = hashInvitationToken(token);
  const result = await db.query<WorkspaceInvitationRow>(
    `
      insert into workspace_invitations (
        workspace_id,
        email,
        role,
        token_hash,
        invited_by_sub
      )
      values ($1, $2, $3, $4, $5)
      returning
        id,
        workspace_id,
        email,
        role,
        token_hash,
        invited_by_sub,
        created_at,
        updated_at,
        expires_at,
        accepted_at,
        revoked_at
    `,
    [input.workspaceId, email, role, tokenHash, invitedBySub],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Workspace invitation creation returned no rows');
  }

  return {
    invitation: mapWorkspaceInvitationRow(row),
    token,
  };
}

export async function listPendingWorkspaceInvitations(
  db: WorkspaceQueryable,
  workspaceId: string,
): Promise<WorkspaceInvitation[]> {
  const result = await db.query<WorkspaceInvitationRow>(
    `
      select
        id,
        workspace_id,
        email,
        role,
        token_hash,
        invited_by_sub,
        created_at,
        updated_at,
        expires_at,
        accepted_at,
        revoked_at
      from workspace_invitations
      where workspace_id = $1
        and accepted_at is null
        and revoked_at is null
        and expires_at > now()
      order by created_at desc, email asc
    `,
    [workspaceId],
  );

  return result.rows.map(mapWorkspaceInvitationRow);
}

export async function revokeWorkspaceInvitation(
  db: WorkspaceQueryable,
  workspaceId: string,
  invitationId: string,
): Promise<WorkspaceInvitation> {
  const result = await db.query<WorkspaceInvitationRow>(
    `
      update workspace_invitations
      set revoked_at = now(),
          updated_at = now()
      where id = $1
        and workspace_id = $2
        and accepted_at is null
        and revoked_at is null
      returning
        id,
        workspace_id,
        email,
        role,
        token_hash,
        invited_by_sub,
        created_at,
        updated_at,
        expires_at,
        accepted_at,
        revoked_at
    `,
    [invitationId, workspaceId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new WorkspaceNotFoundError();
  }

  return mapWorkspaceInvitationRow(row);
}

export function createInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256')
    .update(normalizeRequiredText(token, 'token'), 'utf8')
    .digest('hex');
}

async function findWorkspace(
  db: WorkspaceQueryable,
  workspaceId: string,
): Promise<Workspace | null> {
  const result = await db.query<WorkspaceRow>(
    `
      select id, name, created_by_sub, created_at, updated_at
      from workspaces
      where id = $1
    `,
    [workspaceId],
  );

  const row = result.rows[0];
  return row ? mapWorkspaceRow(row) : null;
}

function mapWorkspaceRow(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    createdBySub: row.created_by_sub,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWorkspaceMembershipRow(
  row: WorkspaceMembershipRow,
): WorkspaceMembership {
  return {
    workspaceId: row.workspace_id,
    userSub: row.user_sub,
    role: parseWorkspaceRole(row.role),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWorkspaceInvitationRow(
  row: WorkspaceInvitationRow,
): WorkspaceInvitation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    role: parseWorkspaceInviteRole(row.role),
    tokenHash: row.token_hash,
    invitedBySub: row.invited_by_sub,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  };
}

function normalizeEmail(email: string): string {
  const normalized = normalizeRequiredText(email, 'email').toLowerCase();

  if (!normalized.includes('@')) {
    throw new Error('email must be a valid email address');
  }

  return normalized;
}

function normalizeRequiredText(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}
