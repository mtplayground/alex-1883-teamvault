import {
  normalizeProjectDescription,
  normalizeProjectName,
  type NewProjectInput,
  type Project,
} from './model.js';
import type { WorkspaceRole } from '../workspaces/model.js';
import { roleCanListAllProjects, roleCanViewProject } from './permissions.js';

export interface ProjectQueryable {
  query<T>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    rows: T[];
  }>;
}

interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export class ProjectNotFoundError extends Error {
  constructor() {
    super('Project not found');
  }
}

export class ProjectPermissionError extends Error {
  constructor(message = 'Project permission denied') {
    super(message);
  }
}

export async function createProject(
  db: ProjectQueryable,
  input: NewProjectInput,
): Promise<Project> {
  const result = await db.query<ProjectRow>(
    `
      insert into projects (workspace_id, name, description)
      values ($1, $2, $3)
      returning id, workspace_id, name, description, created_at, updated_at
    `,
    [
      normalizeRequiredText(input.workspaceId, 'workspaceId'),
      normalizeProjectName(input.name),
      normalizeProjectDescription(input.description),
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Project creation returned no rows');
  }

  return mapProjectRow(row);
}

export async function listProjectsForRole(
  db: ProjectQueryable,
  input: {
    workspaceId: string;
    userSub: string;
    role: WorkspaceRole;
  },
): Promise<Project[]> {
  const workspaceId = normalizeRequiredText(input.workspaceId, 'workspaceId');

  if (roleCanListAllProjects(input.role)) {
    const result = await db.query<ProjectRow>(
      `
        select id, workspace_id, name, description, created_at, updated_at
        from projects
        where workspace_id = $1
        order by updated_at desc, name asc
      `,
      [workspaceId],
    );

    return result.rows.map(mapProjectRow);
  }

  const result = await db.query<ProjectRow>(
    `
      select p.id, p.workspace_id, p.name, p.description, p.created_at, p.updated_at
      from projects p
      join project_shares ps on ps.project_id = p.id
      where p.workspace_id = $1
        and ps.user_sub = $2
      order by p.updated_at desc, p.name asc
    `,
    [workspaceId, normalizeRequiredText(input.userSub, 'userSub')],
  );

  return result.rows.map(mapProjectRow);
}

export async function getProjectForRole(
  db: ProjectQueryable,
  input: {
    workspaceId: string;
    projectId: string;
    userSub: string;
    role: WorkspaceRole;
  },
): Promise<Project> {
  const project = await findProject(db, input.workspaceId, input.projectId);

  if (!project) {
    throw new ProjectNotFoundError();
  }

  if (roleCanListAllProjects(input.role)) {
    return project;
  }

  const isSharedWithUser = await isProjectSharedWithUser(
    db,
    input.projectId,
    input.userSub,
  );

  if (!roleCanViewProject(input.role, isSharedWithUser)) {
    throw new ProjectPermissionError(
      'Guests can only view projects shared with them',
    );
  }

  return project;
}

export async function updateProject(
  db: ProjectQueryable,
  input: {
    workspaceId: string;
    projectId: string;
    name: string;
    description?: string | null;
  },
): Promise<Project> {
  const result = await db.query<ProjectRow>(
    `
      update projects
      set name = $3,
          description = $4,
          updated_at = now()
      where workspace_id = $1
        and id = $2
      returning id, workspace_id, name, description, created_at, updated_at
    `,
    [
      normalizeRequiredText(input.workspaceId, 'workspaceId'),
      normalizeRequiredText(input.projectId, 'projectId'),
      normalizeProjectName(input.name),
      normalizeProjectDescription(input.description),
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new ProjectNotFoundError();
  }

  return mapProjectRow(row);
}

export async function deleteProject(
  db: ProjectQueryable,
  input: { workspaceId: string; projectId: string },
): Promise<void> {
  const result = await db.query<{ id: string }>(
    `
      delete from projects
      where workspace_id = $1
        and id = $2
      returning id
    `,
    [
      normalizeRequiredText(input.workspaceId, 'workspaceId'),
      normalizeRequiredText(input.projectId, 'projectId'),
    ],
  );

  if (!result.rows[0]) {
    throw new ProjectNotFoundError();
  }
}

async function findProject(
  db: ProjectQueryable,
  workspaceId: string,
  projectId: string,
): Promise<Project | null> {
  const result = await db.query<ProjectRow>(
    `
      select id, workspace_id, name, description, created_at, updated_at
      from projects
      where workspace_id = $1
        and id = $2
    `,
    [
      normalizeRequiredText(workspaceId, 'workspaceId'),
      normalizeRequiredText(projectId, 'projectId'),
    ],
  );

  const row = result.rows[0];
  return row ? mapProjectRow(row) : null;
}

async function isProjectSharedWithUser(
  db: ProjectQueryable,
  projectId: string,
  userSub: string,
): Promise<boolean> {
  const result = await db.query<{ project_id: string }>(
    `
      select project_id
      from project_shares
      where project_id = $1
        and user_sub = $2
    `,
    [
      normalizeRequiredText(projectId, 'projectId'),
      normalizeRequiredText(userSub, 'userSub'),
    ],
  );

  return Boolean(result.rows[0]);
}

function mapProjectRow(row: ProjectRow): Project {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeRequiredText(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}
