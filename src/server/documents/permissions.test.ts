import assert from 'node:assert/strict';
import test from 'node:test';

import {
  roleCanAccessDocument,
  roleCanAccessProjectDocuments,
  roleCanShareDocument,
} from './permissions.js';

test('owners and members can access project documents', () => {
  for (const role of ['owner', 'member'] as const) {
    assert.equal(roleCanAccessProjectDocuments(role), true);
    assert.equal(
      roleCanAccessDocument(role, {
        hasProjectAccess: true,
        isDocumentSharedWithUser: false,
      }),
      true,
    );
    assert.equal(roleCanShareDocument(role, { hasProjectAccess: true }), true);
  }
});

test('guests need project access or an explicit document share', () => {
  assert.equal(roleCanAccessProjectDocuments('guest'), false);
  assert.equal(
    roleCanAccessDocument('guest', {
      hasProjectAccess: false,
      isDocumentSharedWithUser: false,
    }),
    false,
  );
  assert.equal(
    roleCanAccessDocument('guest', {
      hasProjectAccess: true,
      isDocumentSharedWithUser: false,
    }),
    true,
  );
  assert.equal(
    roleCanAccessDocument('guest', {
      hasProjectAccess: false,
      isDocumentSharedWithUser: true,
    }),
    true,
  );
  assert.equal(
    roleCanShareDocument('guest', { hasProjectAccess: true }),
    false,
  );
  assert.equal(
    roleCanShareDocument('guest', { hasProjectAccess: false }),
    false,
  );
  assert.equal(
    roleCanShareDocument('member', { hasProjectAccess: false }),
    false,
  );
});
