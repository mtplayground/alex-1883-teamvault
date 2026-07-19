import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProject,
  getProjectForRole,
  listProjectsForRole,
  ProjectPermissionError,
  type ProjectQueryable,
} from './store.js';

const now = new Date('2026-07-19T00:00:00.000Z');

test('creates projects with normalized name and description', async () => {
  const queries: Array<{
    sql: string;
    values: readonly unknown[] | undefined;
  }> = [];
  const db: ProjectQueryable = {
    query: async <T>(sql: string, values?: readonly unknown[]) => {
      queries.push({ sql, values });
      return { rows: [projectRow()] as T[] };
    },
  };

  const project = await createProject(db, {
    workspaceId: ' workspace-1 ',
    name: ' Launch plan ',
    description: ' Files and dates ',
  });

  assert.equal(project.name, 'Launch plan');
  assert.match(queries[0]?.sql ?? '', /insert into projects/);
  assert.deepEqual(queries[0]?.values, [
    'workspace-1',
    'Launch plan',
    'Files and dates',
  ]);
});

test('guests list only shared projects', async () => {
  const queries: string[] = [];
  const db: ProjectQueryable = {
    query: async <T>(sql: string) => {
      queries.push(sql);
      return { rows: [projectRow()] as T[] };
    },
  };

  const projects = await listProjectsForRole(db, {
    workspaceId: 'workspace-1',
    userSub: 'auth|guest',
    role: 'guest',
  });

  assert.equal(projects.length, 1);
  assert.match(queries[0] ?? '', /join project_shares/);
});

test('guests cannot view unshared projects', async () => {
  const db = sequenceDb([{ rows: [projectRow()] }, { rows: [] }]);

  await assert.rejects(
    () =>
      getProjectForRole(db, {
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        userSub: 'auth|guest',
        role: 'guest',
      }),
    ProjectPermissionError,
  );
});

function sequenceDb(results: Array<{ rows: unknown[] }>): ProjectQueryable {
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

function projectRow() {
  return {
    id: 'project-1',
    workspace_id: 'workspace-1',
    name: 'Launch plan',
    description: 'Files and dates',
    created_at: now,
    updated_at: now,
  };
}
