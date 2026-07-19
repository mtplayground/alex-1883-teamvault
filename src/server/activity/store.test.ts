import assert from 'node:assert/strict';
import test from 'node:test';

import { recordActivity, type ActivityQueryable } from './store.js';

test('records activity entries with normalized ids and metadata', async () => {
  const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
  const now = new Date('2026-07-19T00:00:00.000Z');
  const db: ActivityQueryable = {
    query: async <T>(sql: string, values: readonly unknown[] = []) => {
      queries.push({ sql, values });

      return {
        rows: [
          {
            id: 'activity-1',
            actor_sub: values[0],
            action: values[1],
            workspace_id: values[2],
            project_id: values[3],
            document_id: values[4],
            metadata: values[5],
            created_at: now,
          },
        ] as T[],
      };
    },
  };

  const activity = await recordActivity(db, {
    actorSub: ' auth|123 ',
    action: 'document_uploaded',
    workspaceId: ' workspace-1 ',
    projectId: ' project-1 ',
    documentId: ' document-1 ',
    metadata: {
      fileName: 'Launch Plan.pdf',
      sizeBytes: 9,
    },
  });

  assert.match(queries[0]?.sql ?? '', /insert into activity_entries/);
  assert.deepEqual(queries[0]?.values, [
    'auth|123',
    'document_uploaded',
    'workspace-1',
    'project-1',
    'document-1',
    JSON.stringify({ fileName: 'Launch Plan.pdf', sizeBytes: 9 }),
  ]);
  assert.equal(activity.id, 'activity-1');
  assert.equal(activity.action, 'document_uploaded');
  assert.deepEqual(activity.metadata, {
    fileName: 'Launch Plan.pdf',
    sizeBytes: 9,
  });
});
