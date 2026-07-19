import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProjectDocumentShare,
  createProjectDocument,
  getProjectDocument,
  isProjectDocumentSharedWithUser,
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

test('creates document shares for workspace users', async () => {
  const queries: Array<{
    sql: string;
    values: readonly unknown[] | undefined;
  }> = [];
  const db: DocumentQueryable = {
    query: async <T>(sql: string, values?: readonly unknown[]) => {
      queries.push({ sql, values });
      return {
        rows: [
          {
            document_id: values?.[0],
            workspace_id: values?.[1],
            project_id: values?.[2],
            user_sub: values?.[3],
            shared_by_sub: values?.[4],
            created_at: now,
          },
        ] as T[],
      };
    },
  };

  const share = await createProjectDocumentShare(db, {
    documentId: ' document-1 ',
    workspaceId: ' workspace-1 ',
    projectId: ' project-1 ',
    userSub: ' auth|guest ',
    sharedBySub: ' auth|owner ',
  });

  assert.equal(share.documentId, 'document-1');
  assert.equal(share.workspaceId, 'workspace-1');
  assert.equal(share.projectId, 'project-1');
  assert.equal(share.userSub, 'auth|guest');
  assert.equal(share.sharedBySub, 'auth|owner');
  assert.match(queries[0]?.sql ?? '', /insert into project_document_shares/);
  assert.deepEqual(queries[0]?.values, [
    'document-1',
    'workspace-1',
    'project-1',
    'auth|guest',
    'auth|owner',
  ]);
});

test('checks whether a document is shared with a user', async () => {
  const queries: Array<{
    sql: string;
    values: readonly unknown[] | undefined;
  }> = [];
  const db: DocumentQueryable = {
    query: async <T>(sql: string, values?: readonly unknown[]) => {
      queries.push({ sql, values });
      return { rows: [{ document_id: 'document-1' }] as T[] };
    },
  };

  const isShared = await isProjectDocumentSharedWithUser(db, {
    documentId: ' document-1 ',
    userSub: ' auth|guest ',
  });

  assert.equal(isShared, true);
  assert.match(queries[0]?.sql ?? '', /from project_document_shares/);
  assert.deepEqual(queries[0]?.values, ['document-1', 'auth|guest']);
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
