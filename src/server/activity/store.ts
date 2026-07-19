import {
  parseActivityAction,
  type ActivityEntry,
  type NewActivityEntryInput,
} from './model.js';

export interface ActivityQueryable {
  query<T>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    rows: T[];
  }>;
}

interface ActivityEntryRow {
  id: string;
  actor_sub: string;
  action: string;
  workspace_id: string | null;
  project_id: string | null;
  document_id: string | null;
  metadata: Record<string, unknown> | string | null;
  created_at: Date;
}

export async function recordActivity(
  db: ActivityQueryable,
  input: NewActivityEntryInput,
): Promise<ActivityEntry> {
  const result = await db.query<ActivityEntryRow>(
    `
      insert into activity_entries (
        actor_sub,
        action,
        workspace_id,
        project_id,
        document_id,
        metadata
      )
      values ($1, $2, $3, $4, $5, $6::jsonb)
      returning id, actor_sub, action, workspace_id, project_id, document_id, metadata, created_at
    `,
    [
      normalizeRequiredText(input.actorSub, 'actorSub'),
      input.action,
      normalizeOptionalText(input.workspaceId ?? null),
      normalizeOptionalText(input.projectId ?? null),
      normalizeOptionalText(input.documentId ?? null),
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Activity entry creation returned no rows');
  }

  return mapActivityEntryRow(row);
}

function mapActivityEntryRow(row: ActivityEntryRow): ActivityEntry {
  return {
    id: row.id,
    actorSub: row.actor_sub,
    action: parseActivityAction(row.action),
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    documentId: row.document_id,
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at,
  };
}

function parseMetadata(
  value: ActivityEntryRow['metadata'],
): Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  }

  return value;
}

function normalizeRequiredText(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}

function normalizeOptionalText(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
