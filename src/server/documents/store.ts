import {
  normalizeDocumentContentType,
  normalizeDocumentFileName,
  normalizeDocumentSize,
  normalizeDocumentStorageKey,
  type NewProjectDocumentInput,
  type ProjectDocument,
} from './model.js';

export interface DocumentQueryable {
  query<T>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    rows: T[];
  }>;
}

interface ProjectDocumentRow {
  id: string;
  workspace_id: string;
  project_id: string;
  file_name: string;
  content_type: string;
  size_bytes: string | number;
  uploader_sub: string;
  storage_key: string;
  uploaded_at: Date;
}

export class ProjectDocumentNotFoundError extends Error {
  constructor() {
    super('Project document not found');
  }
}

export async function createProjectDocument(
  db: DocumentQueryable,
  input: NewProjectDocumentInput,
): Promise<ProjectDocument> {
  const result = await db.query<ProjectDocumentRow>(
    `
      insert into project_documents (
        id,
        workspace_id,
        project_id,
        file_name,
        content_type,
        size_bytes,
        uploader_sub,
        storage_key
      )
      values (coalesce($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8)
      returning id, workspace_id, project_id, file_name, content_type, size_bytes, uploader_sub, storage_key, uploaded_at
    `,
    [
      input.id ?? null,
      normalizeRequiredText(input.workspaceId, 'workspaceId'),
      normalizeRequiredText(input.projectId, 'projectId'),
      normalizeDocumentFileName(input.fileName),
      normalizeDocumentContentType(input.contentType),
      normalizeDocumentSize(input.sizeBytes),
      normalizeRequiredText(input.uploaderSub, 'uploaderSub'),
      normalizeDocumentStorageKey(input.storageKey),
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Project document creation returned no rows');
  }

  return mapProjectDocumentRow(row);
}

export async function listProjectDocuments(
  db: DocumentQueryable,
  input: { workspaceId: string; projectId: string },
): Promise<ProjectDocument[]> {
  const result = await db.query<ProjectDocumentRow>(
    `
      select id, workspace_id, project_id, file_name, content_type, size_bytes, uploader_sub, storage_key, uploaded_at
      from project_documents
      where workspace_id = $1
        and project_id = $2
      order by uploaded_at desc, file_name asc
    `,
    [
      normalizeRequiredText(input.workspaceId, 'workspaceId'),
      normalizeRequiredText(input.projectId, 'projectId'),
    ],
  );

  return result.rows.map(mapProjectDocumentRow);
}

export async function getProjectDocument(
  db: DocumentQueryable,
  input: { workspaceId: string; projectId: string; documentId: string },
): Promise<ProjectDocument> {
  const result = await db.query<ProjectDocumentRow>(
    `
      select id, workspace_id, project_id, file_name, content_type, size_bytes, uploader_sub, storage_key, uploaded_at
      from project_documents
      where workspace_id = $1
        and project_id = $2
        and id = $3
    `,
    [
      normalizeRequiredText(input.workspaceId, 'workspaceId'),
      normalizeRequiredText(input.projectId, 'projectId'),
      normalizeRequiredText(input.documentId, 'documentId'),
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new ProjectDocumentNotFoundError();
  }

  return mapProjectDocumentRow(row);
}

function mapProjectDocumentRow(row: ProjectDocumentRow): ProjectDocument {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    uploaderSub: row.uploader_sub,
    storageKey: row.storage_key,
    uploadedAt: row.uploaded_at,
  };
}

function normalizeRequiredText(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}
