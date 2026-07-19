import {
  normalizeDocumentContentType,
  normalizeDocumentFileName,
  normalizeDocumentSize,
  normalizeDocumentStorageKey,
  type NewProjectDocumentShareInput,
  type NewProjectDocumentInput,
  type ProjectDocument,
  type ProjectDocumentShare,
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

interface ProjectDocumentShareRow {
  document_id: string;
  workspace_id: string;
  project_id: string;
  user_sub: string;
  shared_by_sub: string;
  created_at: Date;
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

export async function createProjectDocumentShare(
  db: DocumentQueryable,
  input: NewProjectDocumentShareInput,
): Promise<ProjectDocumentShare> {
  const result = await db.query<ProjectDocumentShareRow>(
    `
      insert into project_document_shares (
        document_id,
        workspace_id,
        project_id,
        user_sub,
        shared_by_sub
      )
      values ($1, $2, $3, $4, $5)
      on conflict (document_id, user_sub)
      do update set shared_by_sub = excluded.shared_by_sub
      returning document_id, workspace_id, project_id, user_sub, shared_by_sub, created_at
    `,
    [
      normalizeRequiredText(input.documentId, 'documentId'),
      normalizeRequiredText(input.workspaceId, 'workspaceId'),
      normalizeRequiredText(input.projectId, 'projectId'),
      normalizeRequiredText(input.userSub, 'userSub'),
      normalizeRequiredText(input.sharedBySub, 'sharedBySub'),
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Project document share creation returned no rows');
  }

  return mapProjectDocumentShareRow(row);
}

export async function isProjectDocumentSharedWithUser(
  db: DocumentQueryable,
  input: { documentId: string; userSub: string },
): Promise<boolean> {
  const result = await db.query<{ document_id: string }>(
    `
      select document_id
      from project_document_shares
      where document_id = $1
        and user_sub = $2
    `,
    [
      normalizeRequiredText(input.documentId, 'documentId'),
      normalizeRequiredText(input.userSub, 'userSub'),
    ],
  );

  return Boolean(result.rows[0]);
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

function mapProjectDocumentShareRow(
  row: ProjectDocumentShareRow,
): ProjectDocumentShare {
  return {
    documentId: row.document_id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    userSub: row.user_sub,
    sharedBySub: row.shared_by_sub,
    createdAt: row.created_at,
  };
}

function normalizeRequiredText(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}
