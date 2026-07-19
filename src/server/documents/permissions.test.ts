import assert from 'node:assert/strict';
import test from 'node:test';

import {
  roleCanAccessDocument,
  roleCanAccessProjectDocuments,
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
});
