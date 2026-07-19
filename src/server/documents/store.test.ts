import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProjectDocument,
  getProjectDocument,
  listProjectDocuments,
  ProjectDocumentNotFoundError,
  type DocumentQueryable,
} from './store.js';

const now = new Date('2026-07-19T00:00:00.000Z');

test('creates document metadata with normalized values', async () => {
  const queries: Array<{
    sql: string;
    values: readonly unknown[] | undefined;
  }> = [];
  const db: DocumentQueryable = {
    query: async <T>(sql: string, values?: readonly unknown[]) => {
      queries.push({ sql, values });
      return { rows: [documentRow()] as T[] };
    },
  };

  const document = await createProjectDocument(db, {
    id: 'document-1',
    workspaceId: ' workspace-1 ',
    projectId: ' project-1 ',
    fileName: ' /tmp/Plan.PDF ',
    contentType: ' Application/PDF ',
    sizeBytes: 128,
    uploaderSub: ' auth|user ',
    storageKey: ' documents/document-1 ',
  });

  assert.equal(document.fileName, 'Plan.PDF');
  assert.equal(document.sizeBytes, 128);
  assert.match(queries[0]?.sql ?? '', /insert into project_documents/);
  assert.deepEqual(queries[0]?.values, [
    'document-1',
    'workspace-1',
    'project-1',
    'Plan.PDF',
    'application/pdf',
    128,
    'auth|user',
    'documents/document-1',
  ]);
});

test('lists project documents in upload order', async () => {
  const queries: string[] = [];
  const db: DocumentQueryable = {
    query: async <T>(sql: string) => {
      queries.push(sql);
      return { rows: [documentRow()] as T[] };
    },
  };

  const documents = await listProjectDocuments(db, {
    workspaceId: 'workspace-1',
    projectId: 'project-1',
  });

  assert.equal(documents.length, 1);
  assert.match(queries[0] ?? '', /order by uploaded_at desc/);
});

test('throws when document metadata cannot be found', async () => {
  const db: DocumentQueryable = {
    query: async <T>() => ({ rows: [] as T[] }),
  };

  await assert.rejects(
    () =>
      getProjectDocument(db, {
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        documentId: 'document-1',
      }),
    ProjectDocumentNotFoundError,
  );
});

function documentRow() {
  return {
    id: 'document-1',
    workspace_id: 'workspace-1',
    project_id: 'project-1',
    file_name: 'Plan.PDF',
    content_type: 'application/pdf',
    size_bytes: '128',
    uploader_sub: 'auth|user',
    storage_key: 'documents/document-1',
    uploaded_at: now,
  };
}
