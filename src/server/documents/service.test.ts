import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectDocumentStorageKey,
  retrieveProjectDocument,
  saveProjectDocument,
} from './service.js';
import type { DocumentQueryable } from './store.js';
import type { ObjectStorage } from '../storage/s3.js';

const now = new Date('2026-07-19T00:00:00.000Z');

test('builds stable document object keys', () => {
  assert.equal(
    projectDocumentStorageKey({
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      documentId: 'document-1',
      fileName: 'Deal memo final.pdf',
    }),
    'workspaces/workspace-1/projects/project-1/documents/document-1/Deal-memo-final.pdf',
  );
});

test('saves the object before recording document metadata', async () => {
  const events: string[] = [];
  let storedKey = '';
  const db: DocumentQueryable = {
    query: async <T>(_sql: string, values?: readonly unknown[]) => {
      events.push('db');
      return {
        rows: [
          {
            id: values?.[0],
            workspace_id: values?.[1],
            project_id: values?.[2],
            file_name: values?.[3],
            content_type: values?.[4],
            size_bytes: values?.[5],
            uploader_sub: values?.[6],
            storage_key: values?.[7],
            uploaded_at: now,
          },
        ] as T[],
      };
    },
  };
  const storage: ObjectStorage = {
    putObject: async (input) => {
      events.push('storage');
      storedKey = input.key;
      assert.equal(input.contentType, 'application/pdf');
      assert.equal(Buffer.from(input.body).toString('utf8'), 'hello');
    },
    getObject: async () => {
      throw new Error('unexpected get');
    },
  };

  const document = await saveProjectDocument(db, storage, {
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    uploaderSub: 'auth|user',
    fileName: ' Plan.pdf ',
    contentType: ' Application/PDF ',
    body: Buffer.from('hello'),
  });

  assert.deepEqual(events, ['storage', 'db']);
  assert.equal(document.fileName, 'Plan.pdf');
  assert.equal(document.sizeBytes, 5);
  assert.equal(document.storageKey, storedKey);
});

test('retrieves document metadata and object bytes together', async () => {
  const db: DocumentQueryable = {
    query: async <T>() => ({
      rows: [
        {
          id: 'document-1',
          workspace_id: 'workspace-1',
          project_id: 'project-1',
          file_name: 'Plan.pdf',
          content_type: 'application/pdf',
          size_bytes: '5',
          uploader_sub: 'auth|user',
          storage_key: 'documents/document-1',
          uploaded_at: now,
        },
      ] as T[],
    }),
  };
  const storage: ObjectStorage = {
    putObject: async () => {
      throw new Error('unexpected put');
    },
    getObject: async (key) => {
      assert.equal(key, 'documents/document-1');
      return {
        body: Buffer.from('hello'),
        contentType: 'application/pdf',
        contentLength: 5,
      };
    },
  };

  const result = await retrieveProjectDocument(db, storage, {
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    documentId: 'document-1',
  });

  assert.equal(result.document.id, 'document-1');
  assert.equal(result.file.body.toString('utf8'), 'hello');
});
