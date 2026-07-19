import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import type { AuthConfig } from '../config.js';
import type { MctaiJwtVerifier } from '../auth/session.js';
import { createProjectRouter } from './routes.js';
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
  const db = routeDb([userRow(), roleRow('member'), projectRows()]);
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

async function withProjectServer(
  db: ProjectQueryable,
  request: (baseUrl: string) => Promise<Response>,
): Promise<Response> {
  const app = express();
  app.use(express.json());
  app.use('/api/workspaces', createProjectRouter({ authConfig, db, verifier }));

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

function routeDb(results: Array<{ rows: unknown[] }>): ProjectQueryable {
  return {
    query: async <T>() => {
      const result = results.shift();
      if (!result) {
        throw new Error('Unexpected query');
      }

      return { rows: result.rows as T[] };
    },
  };
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
