import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import type { AuthConfig } from '../config.js';
import type { SendEmailInput } from '../email/client.js';
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
    activityRows('user_joined'),
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
  assertActivity(db, 'user_joined');
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

test('workspace invitation endpoint creates token and sends email', async () => {
  const sentEmails: SendEmailInput[] = [];
  const db = routeDb([
    userRow(),
    membershipRows('owner'),
    workspaceRow(),
    membershipRows('owner'),
    invitationRows('lee@example.test', 'member'),
    activityRows('invitation_sent'),
  ]);
  const response = await withWorkspaceServer(
    db,
    (baseUrl) =>
      fetch(`${baseUrl}/api/workspaces/workspace-1/invitations`, {
        method: 'POST',
        headers: {
          cookie: 'mctai_session=valid',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email: 'Lee@Example.Test', role: 'member' }),
      }),
    {
      emailSender: {
        send: async (input) => {
          sentEmails.push(input);
          return { status: 'sent', id: 'message-1' };
        },
      },
      invitationTokenGenerator: () => 'route-token',
    },
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    invitation: invitationResponse('lee@example.test', 'member'),
    email: {
      status: 'sent',
      id: 'message-1',
    },
  });
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0]?.to, 'lee@example.test');
  assert.match(sentEmails[0]?.html ?? '', /route-token/);
  assert.match(sentEmails[0]?.text ?? '', /Accept invitation:/);
  assertActivity(db, 'invitation_sent');
});

test('invitation accept endpoint adds verified user membership', async () => {
  const db = routeDb([
    userRow(),
    invitationRows('owner@example.test', 'guest'),
    acceptedInvitationRows('owner@example.test', 'guest'),
    activityRows('invitation_accepted'),
  ]);
  const response = await withWorkspaceServer(db, (baseUrl) =>
    fetch(`${baseUrl}/api/workspaces/invitations/accept`, {
      method: 'POST',
      headers: {
        cookie: 'mctai_session=valid',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ token: 'route-token' }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    invitation: invitationResponse('owner@example.test', 'guest', now),
    membership: {
      workspaceId: 'workspace-1',
      userSub: 'auth|123',
      role: 'guest',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  });
  assertActivity(db, 'invitation_accepted');
});

async function withWorkspaceServer(
  db: WorkspaceQueryable,
  request: (baseUrl: string) => Promise<Response>,
  options: Partial<Parameters<typeof createWorkspaceRouter>[0]> = {},
): Promise<Response> {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/workspaces',
    createWorkspaceRouter({
      authConfig,
      db,
      selfUrl: 'https://app.example.test',
      verifier,
      ...options,
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

function routeDb(results: Array<{ rows: unknown[] }>): WorkspaceQueryable & {
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

function invitationRows(
  email: string,
  role: 'member' | 'guest',
  acceptedAt: Date | null = null,
) {
  return {
    rows: [
      {
        id: 'invite-1',
        workspace_id: 'workspace-1',
        email,
        role,
        token_hash:
          '55f60340364f6886ff184d6a149f549ad80cdf91d2e5b35f932e0776741559b3',
        invited_by_sub: 'auth|123',
        created_at: now,
        updated_at: now,
        expires_at: new Date('2026-07-26T00:00:00.000Z'),
        accepted_at: acceptedAt,
        revoked_at: null,
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
        project_id: null,
        document_id: null,
        metadata: {},
        created_at: now,
      },
    ],
  };
}

function acceptedInvitationRows(email: string, role: 'member' | 'guest') {
  return {
    rows: [
      {
        ...invitationRows(email, role, now).rows[0],
        member_workspace_id: 'workspace-1',
        member_user_sub: 'auth|123',
        member_role: role,
        member_created_at: now,
        member_updated_at: now,
      },
    ],
  };
}

function invitationResponse(
  email: string,
  role: 'member' | 'guest',
  acceptedAt: Date | null = null,
) {
  return {
    id: 'invite-1',
    workspaceId: 'workspace-1',
    email,
    role,
    invitedBySub: 'auth|123',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: '2026-07-26T00:00:00.000Z',
    acceptedAt: acceptedAt?.toISOString() ?? null,
    revokedAt: null,
  };
}
