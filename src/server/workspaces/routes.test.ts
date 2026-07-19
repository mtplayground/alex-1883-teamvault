import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import type { AuthConfig } from '../config.js';
import type { MctaiJwtVerifier } from '../auth/session.js';
import { createWorkspaceRouter } from './routes.js';
import type { WorkspaceQueryable } from './store.js';

const authConfig: AuthConfig = {
  url: 'https://auth.example.test',
  appToken: 'app_token',
  jwksUrl: 'https://auth.example.test/.well-known/jwks.json',
};

const verifier: MctaiJwtVerifier = async () => ({
  sub: 'auth|123',
  email: 'owner@example.test',
  email_verified: true,
  name: 'Owner',
});

test('workspace create endpoint returns the owner membership', async () => {
  const db = routeDb([
    userRow(),
    workspaceRow(),
    workspaceRow(),
    membershipRows('owner'),
  ]);
  const response = await withWorkspaceServer(db, (baseUrl) =>
    fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: {
        cookie: 'mctai_session=valid',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Client Vault' }),
    }),
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    workspace: {
      id: 'workspace-1',
      name: 'Client Vault',
      createdBySub: 'auth|123',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    members: [
      {
        workspaceId: 'workspace-1',
        userSub: 'auth|123',
        role: 'owner',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ],
  });
});

test('workspace update endpoint rejects non-owners', async () => {
  const db = routeDb([userRow(), membershipRows('member')]);
  const response = await withWorkspaceServer(db, (baseUrl) =>
    fetch(`${baseUrl}/api/workspaces/workspace-1`, {
      method: 'PATCH',
      headers: {
        cookie: 'mctai_session=valid',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'New Name' }),
    }),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: 'Only workspace owners can manage it',
  });
});

async function withWorkspaceServer(
  db: WorkspaceQueryable,
  request: (baseUrl: string) => Promise<Response>,
): Promise<Response> {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/workspaces',
    createWorkspaceRouter({ authConfig, db, verifier }),
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

function routeDb(results: Array<{ rows: unknown[] }>): WorkspaceQueryable {
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
        email: 'owner@example.test',
        email_verified: true,
        name: 'Owner',
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

function workspaceRow() {
  return {
    rows: [
      {
        id: 'workspace-1',
        name: 'Client Vault',
        created_by_sub: 'auth|123',
        created_at: now,
        updated_at: now,
      },
    ],
  };
}

function membershipRows(role: 'owner' | 'member' | 'guest') {
  return {
    rows: [
      {
        workspace_id: 'workspace-1',
        user_sub: 'auth|123',
        role,
        created_at: now,
        updated_at: now,
      },
    ],
  };
}
