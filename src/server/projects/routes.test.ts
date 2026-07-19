import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import type { AuthConfig } from '../config.js';
import type { MctaiJwtVerifier } from '../auth/session.js';
import type { SendEmailInput } from '../email/client.js';
import type { ObjectStorage, PutObjectInput } from '../storage/s3.js';
import { createProjectRouter, type ProjectEmailSender } from './routes.js';
import type { ProjectQueryable } from './store.js';

const authConfig: AuthConfig = {
  url: 'https://auth.example.test',
  appToken: 'app_token',
  jwksUrl: 'https://auth.example.test/.well-known/jwks.json',
};

const verifier: MctaiJwtVerifier = async () => ({
  sub: 'auth|123',
  email: 'member@example.test',
  email_verified: true,
  name: 'Member',
});

test('member can create a project in a workspace', async () => {
  const db = routeDb([
    userRow(),
    roleRow('member'),
    projectRows(),
    activityRows('project_created'),
  ]);
  const response = await withProjectServer(db, (baseUrl) =>
    fetch(`${baseUrl}/api/workspaces/workspace-1/projects`, {
      method: 'POST',
      headers: {
        cookie: 'mctai_session=valid',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Launch plan',
        description: 'Files and dates',
      }),
    }),
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    project: projectResponse(),
  });
  assertActivity(db, 'project_created');
});

test('guest cannot update a project', async () => {
  const db = routeDb([userRow(), roleRow('guest')]);
  const response = await withProjectServer(db, (baseUrl) =>
    fetch(`${baseUrl}/api/workspaces/workspace-1/projects/project-1`, {
      method: 'PATCH',
      headers: {
        cookie: 'mctai_session=valid',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Updated' }),
    }),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: 'Guests cannot edit projects',
  });
});

test('member can upload a PDF document to a project', async () => {
  const storedObjects: PutObjectInput[] = [];
  const activityActions: unknown[] = [];
  const db: ProjectQueryable = {
    query: async <T>(sql: string, values?: readonly unknown[]) => {
      if (/from users/.test(sql) || /insert into users/.test(sql)) {
        return userRow() as { rows: T[] };
      }

      if (/from workspace_members/.test(sql)) {
        return roleRow('member') as { rows: T[] };
      }

      if (/from projects/.test(sql)) {
        return projectRows() as { rows: T[] };
      }

      if (/insert into project_documents/.test(sql)) {
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
      }

      if (/insert into activity_entries/.test(sql)) {
        activityActions.push(values?.[1]);
        return activityRows('document_uploaded') as { rows: T[] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const response = await withProjectServer(
    db,
    (baseUrl) =>
      fetch(
        `${baseUrl}/api/workspaces/workspace-1/projects/project-1/documents`,
        {
          method: 'POST',
          headers: {
            cookie: 'mctai_session=valid',
            'content-type': 'application/pdf',
            'x-file-name': ' Launch Plan.pdf ',
          },
          body: Buffer.from('pdf-bytes'),
        },
      ),
    {
      storage: {
        putObject: async (input) => {
          storedObjects.push(input);
        },
        getObject: async () => {
          throw new Error('unexpected get');
        },
      },
    },
  );
  const body = (await response.json()) as {
    document: { id: string; storageKey?: string; [key: string]: unknown };
  };

  assert.equal(response.status, 201);
  assert.equal(body.document.workspaceId, 'workspace-1');
  assert.equal(body.document.projectId, 'project-1');
  assert.equal(body.document.fileName, 'Launch Plan.pdf');
  assert.equal(body.document.contentType, 'application/pdf');
  assert.equal(body.document.sizeBytes, 9);
  assert.equal(body.document.uploaderSub, 'auth|123');
  assert.equal(body.document.uploadedAt, now.toISOString());
  assert.equal(storedObjects.length, 1);
  assert.equal(storedObjects[0]?.contentType, 'application/pdf');
  assert.equal(
    Buffer.from(storedObjects[0]?.body ?? '').toString(),
    'pdf-bytes',
  );
  assert.match(
    storedObjects[0]?.key ?? '',
    /^workspaces\/workspace-1\/projects\/project-1\/documents\/.+\/Launch-Plan.pdf$/,
  );
  assert.deepEqual(activityActions, ['document_uploaded']);
});

test('guest cannot upload documents to a project', async () => {
  const db = routeDb([userRow(), roleRow('guest')]);
  const response = await withProjectServer(db, (baseUrl) =>
    fetch(
      `${baseUrl}/api/workspaces/workspace-1/projects/project-1/documents`,
      {
        method: 'POST',
        headers: {
          cookie: 'mctai_session=valid',
          'content-type': 'application/pdf',
          'x-file-name': 'Plan.pdf',
        },
        body: Buffer.from('pdf-bytes'),
      },
    ),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: 'Guests cannot upload documents',
  });
});

test('upload rejects unsupported file types', async () => {
  const db = routeDb([userRow(), roleRow('member'), projectRows()]);
  const response = await withProjectServer(db, (baseUrl) =>
    fetch(
      `${baseUrl}/api/workspaces/workspace-1/projects/project-1/documents`,
      {
        method: 'POST',
        headers: {
          cookie: 'mctai_session=valid',
          'content-type': 'text/plain',
          'x-file-name': 'notes.txt',
        },
        body: Buffer.from('not allowed'),
      },
    ),
  );

  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), {
    error: 'Only PDF, PNG, JPEG, GIF, and WebP files are supported',
  });
});

test('upload rejects files over the maximum size', async () => {
  const db = routeDb([userRow()]);
  const response = await withProjectServer(db, (baseUrl) =>
    fetch(
      `${baseUrl}/api/workspaces/workspace-1/projects/project-1/documents`,
      {
        method: 'POST',
        headers: {
          cookie: 'mctai_session=valid',
          'content-type': 'application/pdf',
          'x-file-name': 'large.pdf',
        },
        body: Buffer.alloc(10 * 1024 * 1024 + 1),
      },
    ),
  );

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: 'File must be 10485760 bytes or smaller',
  });
});

test('member can list project documents', async () => {
  const db = routeDb([
    userRow(),
    roleRow('member'),
    projectRows(),
    documentRows(),
  ]);
  const response = await withProjectServer(db, (baseUrl) =>
    fetch(
      `${baseUrl}/api/workspaces/workspace-1/projects/project-1/documents`,
      {
        headers: {
          cookie: 'mctai_session=valid',
        },
      },
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    documents: [documentResponse()],
  });
});

test('guest lists only explicitly shared project documents', async () => {
  const db = routeDb([
    userRow(),
    roleRow('guest'),
    projectRows(),
    shareRows(),
    documentRows(),
  ]);
  const response = await withProjectServer(db, (baseUrl) =>
    fetch(
      `${baseUrl}/api/workspaces/workspace-1/projects/project-1/documents`,
      {
        headers: {
          cookie: 'mctai_session=valid',
        },
      },
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    documents: [documentResponse()],
  });
});

test('guest can download documents from a shared project', async () => {
  const db = routeDb([
    userRow(),
    roleRow('guest'),
    documentRows(),
    projectRows(),
    shareRows(),
  ]);
  const response = await withProjectServer(
    db,
    (baseUrl) =>
      fetch(
        `${baseUrl}/api/workspaces/workspace-1/projects/project-1/documents/document-1/download`,
        {
          headers: {
            cookie: 'mctai_session=valid',
          },
        },
      ),
    {
      storage: {
        putObject: async () => {
          throw new Error('unexpected put');
        },
        getObject: async (key) => {
          assert.equal(key, 'documents/document-1');
          return {
            body: Buffer.from('pdf-bytes'),
            contentType: 'application/pdf',
            contentLength: 9,
          };
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(
    response.headers.get('content-disposition'),
    'attachment; filename="Launch Plan.pdf"',
  );
  assert.equal(
    Buffer.from(await response.arrayBuffer()).toString(),
    'pdf-bytes',
  );
});

test('guest cannot list documents from an unshared project', async () => {
  const db = routeDb([userRow(), roleRow('guest'), projectRows(), emptyRows()]);
  const response = await withProjectServer(db, (baseUrl) =>
    fetch(
      `${baseUrl}/api/workspaces/workspace-1/projects/project-1/documents`,
      {
        headers: {
          cookie: 'mctai_session=valid',
        },
      },
    ),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: 'Guests can only view projects shared with them',
  });
});

test('member can list document shares', async () => {
  const db = routeDb([
    userRow(),
    roleRow('member'),
    documentRows(),
    projectRows(),
    documentShareRows(),
  ]);
  const response = await withProjectServer(db, (baseUrl) =>
    fetch(
      `${baseUrl}/api/workspaces/workspace-1/projects/project-1/documents/document-1/shares`,
      {
        headers: {
          cookie: 'mctai_session=valid',
        },
      },
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    shares: [documentShareResponse()],
  });
});

test('member can share a document with a workspace user and sends email', async () => {
  const sentEmails: SendEmailInput[] = [];
  const db = routeDb([
    userRow(),
    roleRow('member'),
    documentRows(),
    projectRows(),
    shareRecipientRows(),
    documentShareRows({ inserted: true }),
    activityRows('document_shared'),
  ]);
  const response = await withProjectServer(
    db,
    (baseUrl) =>
      fetch(
        `${baseUrl}/api/workspaces/workspace-1/projects/project-1/documents/document-1/shares`,
        {
          method: 'POST',
          headers: {
            cookie: 'mctai_session=valid',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ userSub: 'auth|guest' }),
        },
      ),
    {
      selfUrl: 'https://vault.example.test',
      emailSender: {
        send: async (input) => {
          sentEmails.push(input);
          return { status: 'sent', id: 'email-1' };
        },
      },
    },
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    share: documentShareResponse(),
    email: { status: 'sent', id: 'email-1' },
  });
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0]?.to, 'guest@example.test');
  assert.equal(sentEmails[0]?.subject, 'A document was shared with you');
  assert.match(
    sentEmails[0]?.text ?? '',
    /https:\/\/vault\.example\.test\/projects\/project-1\/documents\/document-1/,
  );
  assertActivity(db, 'document_shared');
});

test('existing document share does not send duplicate email', async () => {
  let sendCount = 0;
  const db = routeDb([
    userRow(),
    roleRow('member'),
    documentRows(),
    projectRows(),
    shareRecipientRows(),
    documentShareRows({ inserted: false }),
  ]);
  const response = await withProjectServer(
    db,
    (baseUrl) =>
      fetch(
        `${baseUrl}/api/workspaces/workspace-1/projects/project-1/documents/document-1/shares`,
        {
          method: 'POST',
          headers: {
            cookie: 'mctai_session=valid',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ userSub: 'auth|guest' }),
        },
      ),
    {
      emailSender: {
        send: async () => {
          sendCount += 1;
          return { status: 'sent', id: 'email-1' };
        },
      },
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { email: unknown };
  assert.equal(body.email, null);
  assert.equal(sendCount, 0);
});

test('member can unshare a document', async () => {
  const db = routeDb([
    userRow(),
    roleRow('member'),
    documentRows(),
    projectRows(),
    deletedShareRows(),
  ]);
  const response = await withProjectServer(db, (baseUrl) =>
    fetch(
      `${baseUrl}/api/workspaces/workspace-1/projects/project-1/documents/document-1/shares/auth%7Cguest`,
      {
        method: 'DELETE',
        headers: {
          cookie: 'mctai_session=valid',
        },
      },
    ),
  );

  assert.equal(response.status, 204);
});

test('guest cannot share documents even with project access', async () => {
  const db = routeDb([
    userRow(),
    roleRow('guest'),
    documentRows(),
    projectRows(),
    shareRows(),
  ]);
  const response = await withProjectServer(db, (baseUrl) =>
    fetch(
      `${baseUrl}/api/workspaces/workspace-1/projects/project-1/documents/document-1/shares`,
      {
        method: 'POST',
        headers: {
          cookie: 'mctai_session=valid',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ userSub: 'auth|other' }),
      },
    ),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: 'Only project owners and members can share documents',
  });
});

test('guest can download explicitly shared documents without project access', async () => {
  const db = routeDb([
    userRow(),
    roleRow('guest'),
    documentRows(),
    projectRows(),
    emptyRows(),
    documentShareRows(),
  ]);
  const response = await withProjectServer(
    db,
    (baseUrl) =>
      fetch(
        `${baseUrl}/api/workspaces/workspace-1/projects/project-1/documents/document-1/download`,
        {
          headers: {
            cookie: 'mctai_session=valid',
          },
        },
      ),
    {
      storage: {
        putObject: async () => {
          throw new Error('unexpected put');
        },
        getObject: async (key) => {
          assert.equal(key, 'documents/document-1');
          return {
            body: Buffer.from('pdf-bytes'),
            contentType: 'application/pdf',
            contentLength: 9,
          };
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('content-disposition'),
    'attachment; filename="Launch Plan.pdf"',
  );
});

test('guest cannot download documents without project access or document share', async () => {
  const db = routeDb([
    userRow(),
    roleRow('guest'),
    documentRows(),
    projectRows(),
    emptyRows(),
    emptyRows(),
  ]);
  const response = await withProjectServer(
    db,
    (baseUrl) =>
      fetch(
        `${baseUrl}/api/workspaces/workspace-1/projects/project-1/documents/document-1/download`,
        {
          headers: {
            cookie: 'mctai_session=valid',
          },
        },
      ),
    {
      storage: {
        putObject: async () => {
          throw new Error('unexpected put');
        },
        getObject: async () => {
          throw new Error('unexpected get');
        },
      },
    },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error:
      'Documents can only be viewed by project users or explicitly shared users',
  });
});

test('member can view documents inline', async () => {
  const db = routeDb([
    userRow(),
    roleRow('member'),
    documentRows(),
    projectRows(),
  ]);
  const response = await withProjectServer(
    db,
    (baseUrl) =>
      fetch(
        `${baseUrl}/api/workspaces/workspace-1/projects/project-1/documents/document-1`,
        {
          headers: {
            cookie: 'mctai_session=valid',
          },
        },
      ),
    {
      storage: {
        putObject: async () => {
          throw new Error('unexpected put');
        },
        getObject: async () => ({
          body: Buffer.from('pdf-bytes'),
          contentType: 'application/pdf',
          contentLength: 9,
        }),
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('content-disposition'),
    'inline; filename="Launch Plan.pdf"',
  );
  assert.equal(response.headers.get('cache-control'), 'private, max-age=0');
});

async function withProjectServer(
  db: ProjectQueryable,
  request: (baseUrl: string) => Promise<Response>,
  options: {
    storage?: ObjectStorage | null;
    emailSender?: ProjectEmailSender;
    selfUrl?: string | null;
  } = {},
): Promise<Response> {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/workspaces',
    createProjectRouter({
      authConfig,
      db,
      verifier,
      storage: options.storage,
      emailSender: options.emailSender,
      selfUrl: options.selfUrl,
    }),
  );

  const server = app.listen(0);
  try {
    const address = server.address() as AddressInfo;
    return await request(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

const now = new Date('2026-07-19T00:00:00.000Z');

function routeDb(results: Array<{ rows: unknown[] }>): ProjectQueryable & {
  queries: Array<{ sql: string; values: readonly unknown[] }>;
} {
  const queries: Array<{ sql: string; values: readonly unknown[] }> = [];

  return {
    queries,
    query: async <T>(sql: string, values: readonly unknown[] = []) => {
      queries.push({ sql, values });
      const result = results.shift();
      if (!result) {
        throw new Error('Unexpected query');
      }

      return { rows: result.rows as T[] };
    },
  };
}

function assertActivity(
  db: { queries: Array<{ sql: string; values: readonly unknown[] }> },
  action: string,
): void {
  const activityQuery = db.queries.find((query) =>
    /insert into activity_entries/.test(query.sql),
  );

  assert.ok(activityQuery, 'expected activity entry to be recorded');
  assert.equal(activityQuery.values[1], action);
}

function userRow() {
  return {
    rows: [
      {
        sub: 'auth|123',
        email: 'member@example.test',
        email_verified: true,
        name: 'Member',
        picture_url: null,
        password_hash: null,
        created_at: now,
        updated_at: now,
        last_seen_at: now,
        inserted: false,
      },
    ],
  };
}

function roleRow(role: 'owner' | 'member' | 'guest') {
  return {
    rows: [{ role }],
  };
}

function projectRows() {
  return {
    rows: [
      {
        id: 'project-1',
        workspace_id: 'workspace-1',
        name: 'Launch plan',
        description: 'Files and dates',
        created_at: now,
        updated_at: now,
      },
    ],
  };
}

function shareRows() {
  return {
    rows: [
      {
        project_id: 'project-1',
      },
    ],
  };
}

function documentShareRows({ inserted = true }: { inserted?: boolean } = {}) {
  return {
    rows: [
      {
        document_id: 'document-1',
        workspace_id: 'workspace-1',
        project_id: 'project-1',
        user_sub: 'auth|guest',
        shared_by_sub: 'auth|123',
        created_at: now,
        inserted,
      },
    ],
  };
}

function activityRows(action: string) {
  return {
    rows: [
      {
        id: 'activity-1',
        actor_sub: 'auth|123',
        action,
        workspace_id: 'workspace-1',
        project_id: action === 'user_joined' ? null : 'project-1',
        document_id: action.startsWith('document_') ? 'document-1' : null,
        metadata: {},
        created_at: now,
      },
    ],
  };
}

function deletedShareRows() {
  return {
    rows: [
      {
        document_id: 'document-1',
      },
    ],
  };
}

function shareRecipientRows() {
  return {
    rows: [
      {
        user_sub: 'auth|guest',
        email: 'guest@example.test',
        name: 'Guest',
        role: 'guest',
        workspace_name: 'Client Vault',
      },
    ],
  };
}

function documentRows() {
  return {
    rows: [
      {
        id: 'document-1',
        workspace_id: 'workspace-1',
        project_id: 'project-1',
        file_name: 'Launch Plan.pdf',
        content_type: 'application/pdf',
        size_bytes: '9',
        uploader_sub: 'auth|123',
        storage_key: 'documents/document-1',
        uploaded_at: now,
      },
    ],
  };
}

function emptyRows() {
  return { rows: [] };
}

function projectResponse() {
  return {
    id: 'project-1',
    workspaceId: 'workspace-1',
    name: 'Launch plan',
    description: 'Files and dates',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function documentResponse() {
  return {
    id: 'document-1',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    fileName: 'Launch Plan.pdf',
    contentType: 'application/pdf',
    sizeBytes: 9,
    uploaderSub: 'auth|123',
    uploadedAt: now.toISOString(),
  };
}

function documentShareResponse() {
  return {
    documentId: 'document-1',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    userSub: 'auth|guest',
    sharedBySub: 'auth|123',
    createdAt: now.toISOString(),
  };
}
