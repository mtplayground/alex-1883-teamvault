import { randomUUID } from 'node:crypto';

import {
  normalizeDocumentContentType,
  normalizeDocumentFileName,
  type ProjectDocument,
} from './model.js';
import {
  createProjectDocument,
  getProjectDocument,
  type DocumentQueryable,
} from './store.js';
import type { ObjectStorage, StoredObject } from '../storage/s3.js';

export interface SaveProjectDocumentInput {
  workspaceId: string;
  projectId: string;
  uploaderSub: string;
  fileName: string;
  contentType: string;
  body: Buffer | Uint8Array;
}

export interface RetrievedProjectDocument {
  document: ProjectDocument;
  file: StoredObject;
}

export async function saveProjectDocument(
  db: DocumentQueryable,
  storage: ObjectStorage,
  input: SaveProjectDocumentInput,
): Promise<ProjectDocument> {
  const id = randomUUID();
  const fileName = normalizeDocumentFileName(input.fileName);
  const contentType = normalizeDocumentContentType(input.contentType);
  const body = Buffer.from(input.body);
  const storageKey = projectDocumentStorageKey({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    documentId: id,
    fileName,
  });

  await storage.putObject({
    key: storageKey,
    body,
    contentType,
  });

  return createProjectDocument(db, {
    id,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    fileName,
    contentType,
    sizeBytes: body.byteLength,
    uploaderSub: input.uploaderSub,
    storageKey,
  });
}

export async function retrieveProjectDocument(
  db: DocumentQueryable,
  storage: ObjectStorage,
  input: { workspaceId: string; projectId: string; documentId: string },
): Promise<RetrievedProjectDocument> {
  const document = await getProjectDocument(db, input);
  const file = await storage.getObject(document.storageKey);

  return { document, file };
}

export function projectDocumentStorageKey(input: {
  workspaceId: string;
  projectId: string;
  documentId: string;
  fileName: string;
}): string {
  const fileName = normalizeDocumentFileName(input.fileName)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const safeFileName = fileName.length > 0 ? fileName : 'document';

  return [
    'workspaces',
    normalizeKeySegment(input.workspaceId, 'workspaceId'),
    'projects',
    normalizeKeySegment(input.projectId, 'projectId'),
    'documents',
    normalizeKeySegment(input.documentId, 'documentId'),
    safeFileName,
  ].join('/');
}

function normalizeKeySegment(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0 || normalized.includes('/')) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}
