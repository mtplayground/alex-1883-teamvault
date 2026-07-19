import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isWorkspaceRole,
  normalizeWorkspaceName,
  parseWorkspaceRole,
} from './model.js';

test('normalizes workspace names', () => {
  assert.equal(normalizeWorkspaceName('  Client files  '), 'Client files');
  assert.throws(() => normalizeWorkspaceName('   '), /workspace name/);
});

test('parses supported workspace roles', () => {
  assert.equal(isWorkspaceRole('owner'), true);
  assert.equal(isWorkspaceRole('member'), true);
  assert.equal(isWorkspaceRole('guest'), true);
  assert.equal(isWorkspaceRole('admin'), false);
  assert.equal(parseWorkspaceRole('owner'), 'owner');
  assert.throws(() => parseWorkspaceRole('admin'), /unsupported/);
});
