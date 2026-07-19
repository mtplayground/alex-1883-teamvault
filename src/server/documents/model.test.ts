import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeDocumentContentType,
  normalizeDocumentFileName,
  normalizeDocumentSize,
  normalizeDocumentStorageKey,
} from './model.js';

test('normalizes document metadata fields', () => {
  assert.equal(
    normalizeDocumentFileName(' C:\\fakepath\\Plan.PDF '),
    'Plan.PDF',
  );
  assert.equal(
    normalizeDocumentContentType(' Application/PDF '),
    'application/pdf',
  );
  assert.equal(normalizeDocumentSize(42), 42);
  assert.equal(
    normalizeDocumentStorageKey(' documents/file.pdf '),
    'documents/file.pdf',
  );
});

test('rejects invalid document metadata fields', () => {
  assert.throws(() => normalizeDocumentFileName(' / '), /file name/);
  assert.throws(() => normalizeDocumentContentType('   '), /content type/);
  assert.throws(() => normalizeDocumentSize(-1), /size/);
  assert.throws(() => normalizeDocumentSize(1.5), /size/);
  assert.throws(() => normalizeDocumentStorageKey('   '), /storage key/);
});
