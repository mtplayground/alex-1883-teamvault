import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertRoleCan,
  permissionsForRole,
  roleCan,
  workspacePermissions,
} from './permissions.js';

test('owner can manage workspace, invite, create, upload, view, and download', () => {
  for (const permission of workspacePermissions) {
    assert.equal(roleCan('owner', permission), true, permission);
  }
});

test('member can create projects and upload while retaining shared item access', () => {
  assert.deepEqual(permissionsForRole('member'), [
    'create_projects',
    'upload_documents',
    'view_shared_items',
    'download_shared_items',
  ]);
  assert.equal(roleCan('member', 'manage_workspace'), false);
  assert.equal(roleCan('member', 'invite_members'), false);
});

test('guest can only view and download shared items', () => {
  assert.deepEqual(permissionsForRole('guest'), [
    'view_shared_items',
    'download_shared_items',
  ]);
  assert.equal(roleCan('guest', 'create_projects'), false);
  assert.equal(roleCan('guest', 'upload_documents'), false);
});

test('assertRoleCan throws for denied permissions', () => {
  assert.doesNotThrow(() => assertRoleCan('owner', 'invite_members'));
  assert.throws(
    () => assertRoleCan('guest', 'upload_documents'),
    /guest cannot upload_documents/,
  );
});
