import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeProjectDescription, normalizeProjectName } from './model.js';

test('normalizes project names', () => {
  assert.equal(normalizeProjectName('  Launch plan  '), 'Launch plan');
  assert.throws(() => normalizeProjectName('   '), /project name/);
});

test('normalizes optional project descriptions', () => {
  assert.equal(
    normalizeProjectDescription('  Due diligence files  '),
    'Due diligence files',
  );
  assert.equal(normalizeProjectDescription('   '), null);
  assert.equal(normalizeProjectDescription(null), null);
  assert.equal(normalizeProjectDescription(undefined), null);
});
