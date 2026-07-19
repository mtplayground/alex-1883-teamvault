export interface ProjectDocument {
  id: string;
  workspaceId: string;
  projectId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploaderSub: string;
  storageKey: string;
  uploadedAt: Date;
}

export interface ProjectDocumentShare {
  documentId: string;
  workspaceId: string;
  projectId: string;
  userSub: string;
  sharedBySub: string;
  createdAt: Date;
}

export interface NewProjectDocumentInput {
  id?: string;
  workspaceId: string;
  projectId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploaderSub: string;
  storageKey: string;
}

export interface NewProjectDocumentShareInput {
  documentId: string;
  workspaceId: string;
  projectId: string;
  userSub: string;
  sharedBySub: string;
}

export interface ProjectDocumentShareUpsertResult {
  share: ProjectDocumentShare;
  isNew: boolean;
}

export function normalizeDocumentFileName(fileName: string): string {
  const normalized = fileName.trim().split(/[\\/]/).filter(Boolean).pop() ?? '';

  if (normalized.length === 0) {
    throw new Error('document file name is required');
  }

  return normalized;
}

export function normalizeDocumentContentType(contentType: string): string {
  const normalized = contentType.trim().toLowerCase();

  if (normalized.length === 0) {
    throw new Error('document content type is required');
  }

  return normalized;
}

export function normalizeDocumentSize(sizeBytes: number): number {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error('document size must be a nonnegative integer');
  }

  return sizeBytes;
}

export function normalizeDocumentStorageKey(storageKey: string): string {
  const normalized = storageKey.trim();

  if (normalized.length === 0) {
    throw new Error('document storage key is required');
  }

  return normalized;
}
