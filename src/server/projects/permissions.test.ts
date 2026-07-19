import assert from 'node:assert/strict';
import test from 'node:test';

import {
  roleCanCreateProject,
  roleCanDeleteProject,
  roleCanEditProject,
  roleCanListAllProjects,
  roleCanViewProject,
} from './permissions.js';

test('owners and members can create, edit, delete, and list projects', () => {
  for (const role of ['owner', 'member'] as const) {
    assert.equal(roleCanCreateProject(role), true);
    assert.equal(roleCanEditProject(role), true);
    assert.equal(roleCanDeleteProject(role), true);
    assert.equal(roleCanListAllProjects(role), true);
    assert.equal(roleCanViewProject(role, false), true);
  }
});

test('guests can only view projects shared with them', () => {
  assert.equal(roleCanCreateProject('guest'), false);
  assert.equal(roleCanEditProject('guest'), false);
  assert.equal(roleCanDeleteProject('guest'), false);
  assert.equal(roleCanListAllProjects('guest'), false);
  assert.equal(roleCanViewProject('guest', false), false);
  assert.equal(roleCanViewProject('guest', true), true);
});
