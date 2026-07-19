import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWorkspace,
  requireWorkspaceOwner,
  WorkspacePermissionError,
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

function membershipDb(role: 'owner' | 'member' | 'guest' | null) {
  return {
    query: async <T>() => ({
      rows: role ? ([{ role }] as T[]) : [],
    }),
  };
}
