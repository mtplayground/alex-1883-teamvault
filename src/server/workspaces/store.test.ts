import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acceptWorkspaceInvitation,
  createWorkspace,
  hashInvitationToken,
  issueWorkspaceInvitation,
  listPendingWorkspaceInvitations,
  requireWorkspaceOwner,
  revokeWorkspaceInvitation,
  WorkspacePermissionError,
  WorkspaceNotFoundError,
  type WorkspaceQueryable,
} from './store.js';

const now = new Date('2026-07-19T00:00:00.000Z');

test('creates a workspace and records the creator as owner', async () => {
  const queries: Array<{
    sql: string;
    values: readonly unknown[] | undefined;
  }> = [];
  const db: WorkspaceQueryable = {
    query: async <T>(sql: string, values?: readonly unknown[]) => {
      queries.push({ sql, values });
      return {
        rows: [
          {
            id: 'workspace-1',
            name: 'Client Vault',
            created_by_sub: 'auth|123',
            created_at: now,
            updated_at: now,
          } as T,
        ],
      };
    },
  };

  const workspace = await createWorkspace(db, {
    name: '  Client Vault  ',
    createdBySub: ' auth|123 ',
  });

  assert.equal(workspace.id, 'workspace-1');
  assert.equal(workspace.name, 'Client Vault');
  assert.match(queries[0]?.sql ?? '', /insert into workspaces/);
  assert.match(queries[0]?.sql ?? '', /insert into workspace_memberships/);
  assert.match(queries[0]?.sql ?? '', /'owner'/);
  assert.deepEqual(queries[0]?.values, ['Client Vault', 'auth|123']);
});

test('allows owners to manage workspace settings', async () => {
  const db = membershipDb('owner');

  await assert.doesNotReject(() =>
    requireWorkspaceOwner(db, 'workspace-1', 'auth|123'),
  );
});

test('rejects member and guest workspace management', async () => {
  await assert.rejects(
    () =>
      requireWorkspaceOwner(membershipDb('member'), 'workspace-1', 'auth|2'),
    WorkspacePermissionError,
  );
  await assert.rejects(
    () => requireWorkspaceOwner(membershipDb('guest'), 'workspace-1', 'auth|3'),
    /Only workspace owners/,
  );
  await assert.rejects(
    () => requireWorkspaceOwner(membershipDb(null), 'workspace-1', 'auth|4'),
    /Only workspace owners/,
  );
});

test('issues invitation tokens for member and guest roles', async () => {
  const queries: Array<{
    sql: string;
    values: readonly unknown[] | undefined;
  }> = [];
  const db: WorkspaceQueryable = {
    query: async <T>(sql: string, values?: readonly unknown[]) => {
      queries.push({ sql, values });
      return {
        rows: [
          invitationRow({
            email: 'lee@example.test',
            role: 'member',
            tokenHash: hashInvitationToken('fixed-token'),
          }) as T,
        ],
      };
    },
  };

  const result = await issueWorkspaceInvitation(db, {
    workspaceId: 'workspace-1',
    email: ' Lee@Example.Test ',
    role: 'member',
    invitedBySub: ' auth|123 ',
    tokenGenerator: () => 'fixed-token',
  });

  assert.equal(result.token, 'fixed-token');
  assert.equal(result.invitation.email, 'lee@example.test');
  assert.equal(result.invitation.role, 'member');
  assert.equal(result.invitation.tokenHash, hashInvitationToken('fixed-token'));
  assert.match(queries[0]?.sql ?? '', /insert into workspace_invitations/);
  assert.deepEqual(queries[0]?.values, [
    'workspace-1',
    'lee@example.test',
    'member',
    hashInvitationToken('fixed-token'),
    'auth|123',
  ]);
});

test('lists and revokes pending workspace invitations', async () => {
  const db = sequenceDb([
    { rows: [invitationRow({ email: 'guest@example.test', role: 'guest' })] },
    {
      rows: [
        invitationRow({
          email: 'guest@example.test',
          role: 'guest',
          revokedAt: now,
        }),
      ],
    },
    { rows: [] },
  ]);

  const pending = await listPendingWorkspaceInvitations(db, 'workspace-1');
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.role, 'guest');

  const revoked = await revokeWorkspaceInvitation(
    db,
    'workspace-1',
    'invite-1',
  );
  assert.equal(revoked.revokedAt?.toISOString(), now.toISOString());

  await assert.rejects(
    () => revokeWorkspaceInvitation(db, 'workspace-1', 'missing'),
    WorkspaceNotFoundError,
  );
});

test('rejects owner invitations', async () => {
  await assert.rejects(
    () =>
      issueWorkspaceInvitation(sequenceDb([]), {
        workspaceId: 'workspace-1',
        email: 'owner@example.test',
        role: 'owner',
        invitedBySub: 'auth|123',
        tokenGenerator: () => 'fixed-token',
      } as unknown as Parameters<typeof issueWorkspaceInvitation>[1]),
    /invitation role/,
  );
});

test('accepts a valid invitation and creates workspace membership', async () => {
  const db = sequenceDb([
    {
      rows: [
        invitationRow({
          email: 'lee@example.test',
          role: 'member',
          tokenHash: hashInvitationToken('valid-token'),
        }),
      ],
    },
    {
      rows: [
        acceptedInvitationRow({
          email: 'lee@example.test',
          role: 'member',
        }),
      ],
    },
  ]);

  const result = await acceptWorkspaceInvitation(db, {
    token: 'valid-token',
    userSub: ' auth|lee ',
    userEmail: ' Lee@Example.Test ',
    now,
  });

  assert.equal(result.invitation.acceptedAt?.toISOString(), now.toISOString());
  assert.equal(result.membership.workspaceId, 'workspace-1');
  assert.equal(result.membership.userSub, 'auth|lee');
  assert.equal(result.membership.role, 'member');
});

test('rejects expired and already-used invitations', async () => {
  await assert.rejects(
    () =>
      acceptWorkspaceInvitation(
        sequenceDb([
          {
            rows: [
              invitationRow({
                email: 'lee@example.test',
                role: 'guest',
                expiresAt: new Date('2026-07-18T00:00:00.000Z'),
              }),
            ],
          },
        ]),
        {
          token: 'expired-token',
          userSub: 'auth|lee',
          userEmail: 'lee@example.test',
          now,
        },
      ),
    /Invitation has expired/,
  );

  await assert.rejects(
    () =>
      acceptWorkspaceInvitation(
        sequenceDb([
          {
            rows: [
              invitationRow({
                email: 'lee@example.test',
                role: 'member',
                acceptedAt: now,
              }),
            ],
          },
        ]),
        {
          token: 'used-token',
          userSub: 'auth|lee',
          userEmail: 'lee@example.test',
          now,
        },
      ),
    /already been used/,
  );
});

test('rejects invitations for a different verified email', async () => {
  await assert.rejects(
    () =>
      acceptWorkspaceInvitation(
        sequenceDb([
          {
            rows: [invitationRow({ email: 'lee@example.test', role: 'guest' })],
          },
        ]),
        {
          token: 'valid-token',
          userSub: 'auth|other',
          userEmail: 'other@example.test',
          now,
        },
      ),
    /different email/,
  );
});

function membershipDb(role: 'owner' | 'member' | 'guest' | null) {
  return {
    query: async <T>() => ({
      rows: role ? ([{ role }] as T[]) : [],
    }),
  };
}

function sequenceDb(results: Array<{ rows: unknown[] }>): WorkspaceQueryable {
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

function invitationRow({
  email,
  role,
  tokenHash = hashInvitationToken('token'),
  expiresAt = new Date('2026-07-26T00:00:00.000Z'),
  acceptedAt = null,
  revokedAt = null,
}: {
  email: string;
  role: 'member' | 'guest';
  tokenHash?: string;
  expiresAt?: Date;
  acceptedAt?: Date | null;
  revokedAt?: Date | null;
}) {
  return {
    id: 'invite-1',
    workspace_id: 'workspace-1',
    email,
    role,
    token_hash: tokenHash,
    invited_by_sub: 'auth|123',
    created_at: now,
    updated_at: now,
    expires_at: expiresAt,
    accepted_at: acceptedAt,
    revoked_at: revokedAt,
  };
}

function acceptedInvitationRow({
  email,
  role,
}: {
  email: string;
  role: 'member' | 'guest';
}) {
  return {
    ...invitationRow({
      email,
      role,
      tokenHash: hashInvitationToken('valid-token'),
      acceptedAt: now,
    }),
    member_workspace_id: 'workspace-1',
    member_user_sub: 'auth|lee',
    member_role: role,
    member_created_at: now,
    member_updated_at: now,
  };
}
