import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import type { AuthConfig } from './config.js';
import { createAuthRouter } from './auth/routes.js';
import type { MctaiJwtVerifier } from './auth/session.js';
import { createProjectRouter } from './projects/routes.js';
import type {
  ObjectStorage,
  PutObjectInput,
  StoredObject,
} from './storage/s3.js';
import { createWorkspaceRouter } from './workspaces/routes.js';
import type { WorkspaceInviteRole, WorkspaceRole } from './workspaces/model.js';
import type { SendEmailInput } from './email/client.js';

const authConfig: AuthConfig = {
  url: 'https://auth.example.test',
  appToken: 'app_token',
  jwksUrl: 'https://auth.example.test/.well-known/jwks.json',
};

const usersBySessionToken = new Map([
  [
    'owner-session',
    {
      sub: 'auth|owner',
      email: 'owner@example.test',
      email_verified: true,
      name: 'Owner User',
    },
  ],
  [
    'member-session',
    {
      sub: 'auth|member',
      email: 'member@example.test',
      email_verified: true,
      name: 'Member User',
    },
  ],
  [
    'guest-session',
    {
      sub: 'auth|guest',
      email: 'guest@example.test',
      email_verified: true,
      name: 'Guest User',
    },
  ],
]);

test('core owner/member/guest document journey records activity end to end', async () => {
  const db = new JourneyDatabase();
  const storage = new JourneyStorage();
  const sentEmails: SendEmailInput[] = [];
  const invitationTokens = ['member-token', 'guest-token'];
  const verifier: MctaiJwtVerifier = async (token) => {
    const claims = usersBySessionToken.get(token);
    if (!claims) {
      throw new Error('bad session');
    }

    return claims;
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/api/auth',
    createAuthRouter({
      authConfig,
      db,
      verifier,
      selfUrl: 'https://app.example.test',
    }),
  );
  app.use(
    '/api/workspaces',
    createWorkspaceRouter({
      authConfig,
      db,
      verifier,
      selfUrl: 'https://app.example.test',
      invitationTokenGenerator: () => invitationTokens.shift() ?? 'token',
      emailSender: {
        send: async (input) => {
          sentEmails.push(input);
          return { status: 'sent', id: `email-${sentEmails.length}` };
        },
      },
    }),
  );
  app.use(
    '/api/workspaces',
    createProjectRouter({
      authConfig,
      db,
      verifier,
      storage,
      selfUrl: 'https://app.example.test',
      emailSender: {
        send: async (input) => {
          sentEmails.push(input);
          return { status: 'sent', id: `email-${sentEmails.length}` };
        },
      },
    }),
  );

  await withServer(app, async (baseUrl) => {
    const ownerSession = cookie('owner-session');
    const memberSession = cookie('member-session');
    const guestSession = cookie('guest-session');

    const ownerAuth = await getJson<{ isNew: boolean; user: { sub: string } }>(
      `${baseUrl}/api/auth/session`,
      ownerSession,
    );
    assert.equal(ownerAuth.isNew, true);
    assert.equal(ownerAuth.user.sub, 'auth|owner');

    const workspace = await postJson<{
      workspace: { id: string; name: string };
    }>(`${baseUrl}/api/workspaces`, ownerSession, {
      name: 'Client Vault',
    });
    assert.equal(workspace.workspace.name, 'Client Vault');

    const memberInvite = await inviteUser(baseUrl, ownerSession, {
      workspaceId: workspace.workspace.id,
      email: 'member@example.test',
      role: 'member',
    });
    const guestInvite = await inviteUser(baseUrl, ownerSession, {
      workspaceId: workspace.workspace.id,
      email: 'guest@example.test',
      role: 'guest',
    });
    assert.equal(memberInvite.invitation.role, 'member');
    assert.equal(guestInvite.invitation.role, 'guest');
    assert.equal(sentEmails.length, 2);

    await getJson(`${baseUrl}/api/auth/session`, memberSession);
    await getJson(`${baseUrl}/api/auth/session`, guestSession);
    const memberAcceptance = await postJson<{
      membership: { role: string; workspaceId: string };
    }>(`${baseUrl}/api/workspaces/invitations/accept`, memberSession, {
      token: 'member-token',
    });
    const guestAcceptance = await postJson<{
      membership: { role: string; workspaceId: string };
    }>(`${baseUrl}/api/workspaces/invitations/accept`, guestSession, {
      token: 'guest-token',
    });
    assert.equal(memberAcceptance.membership.role, 'member');
    assert.equal(guestAcceptance.membership.role, 'guest');

    const project = await postJson<{ project: { id: string; name: string } }>(
      `${baseUrl}/api/workspaces/${workspace.workspace.id}/projects`,
      memberSession,
      {
        name: 'Launch plan',
        description: 'Files and dates',
      },
    );
    assert.equal(project.project.name, 'Launch plan');

    const image = await uploadDocument(baseUrl, memberSession, {
      workspaceId: workspace.workspace.id,
      projectId: project.project.id,
      fileName: 'Hero.png',
      contentType: 'image/png',
      body: Buffer.from('png-bytes'),
    });
    const pdf = await uploadDocument(baseUrl, memberSession, {
      workspaceId: workspace.workspace.id,
      projectId: project.project.id,
      fileName: 'Plan.pdf',
      contentType: 'application/pdf',
      body: Buffer.from('pdf-bytes'),
    });
    assert.equal(image.document.contentType, 'image/png');
    assert.equal(pdf.document.contentType, 'application/pdf');
    assert.equal(storage.puts.length, 2);

    const share = await postJson<{
      share: { documentId: string; userSub: string };
      email: { status: string };
    }>(
      `${baseUrl}/api/workspaces/${workspace.workspace.id}/projects/${project.project.id}/documents/${pdf.document.id}/shares`,
      memberSession,
      { userSub: 'auth|guest' },
    );
    assert.equal(share.share.userSub, 'auth|guest');
    assert.equal(share.email.status, 'sent');
    assert.equal(sentEmails.length, 3);
    assert.equal(sentEmails[2]?.to, 'guest@example.test');

    const viewedDocument = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspace.id}/projects/${project.project.id}/documents/${pdf.document.id}`,
      { headers: { cookie: guestSession } },
    );
    assert.equal(viewedDocument.status, 200);
    assert.equal(viewedDocument.headers.get('content-type'), 'application/pdf');
    assert.equal(await viewedDocument.text(), 'pdf-bytes');

    const downloadedDocument = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspace.id}/projects/${project.project.id}/documents/${pdf.document.id}/download`,
      { headers: { cookie: guestSession } },
    );
    assert.equal(downloadedDocument.status, 200);
    assert.match(
      downloadedDocument.headers.get('content-disposition') ?? '',
      /attachment/,
    );
    assert.equal(await downloadedDocument.text(), 'pdf-bytes');

    const activity = await getJson<{
      activities: Array<{ action: string; projectId: string | null }>;
    }>(
      `${baseUrl}/api/workspaces/${workspace.workspace.id}/activity?limit=20`,
      ownerSession,
    );
    const actions = activity.activities.map((entry) => entry.action);
    assert.deepEqual(
      actions.filter((action) =>
        [
          'user_joined',
          'invitation_sent',
          'invitation_accepted',
          'project_created',
          'document_uploaded',
          'document_shared',
        ].includes(action),
      ),
      [
        'document_shared',
        'document_uploaded',
        'document_uploaded',
        'project_created',
        'invitation_accepted',
        'invitation_accepted',
        'invitation_sent',
        'invitation_sent',
        'user_joined',
      ],
    );

    const projectActivity = await getJson<{
      activities: Array<{ action: string; projectId: string | null }>;
    }>(
      `${baseUrl}/api/workspaces/${workspace.workspace.id}/activity?limit=20&projectId=${project.project.id}`,
      memberSession,
    );
    assert.deepEqual(
      projectActivity.activities.map((entry) => entry.action),
      [
        'document_shared',
        'document_uploaded',
        'document_uploaded',
        'project_created',
      ],
    );
  });
});

interface UserRow {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string | null;
  picture_url: string | null;
  password_hash: string | null;
  created_at: Date;
  updated_at: Date;
  last_seen_at: Date;
  inserted: boolean;
}

interface WorkspaceRow {
  id: string;
  name: string;
  created_by_sub: string;
  created_at: Date;
  updated_at: Date;
}

interface MembershipRow {
  workspace_id: string;
  user_sub: string;
  role: WorkspaceRole;
  created_at: Date;
  updated_at: Date;
}

interface InvitationRow {
  id: string;
  workspace_id: string;
  email: string;
  role: WorkspaceInviteRole;
  token_hash: string;
  invited_by_sub: string;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

interface DocumentRow {
  id: string;
  workspace_id: string;
  project_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploader_sub: string;
  storage_key: string;
  uploaded_at: Date;
}

interface DocumentShareRow {
  document_id: string;
  workspace_id: string;
  project_id: string;
  user_sub: string;
  shared_by_sub: string;
  created_at: Date;
  inserted: boolean;
}

interface ActivityRow {
  id: string;
  actor_sub: string;
  action: string;
  workspace_id: string | null;
  project_id: string | null;
  document_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

class JourneyDatabase {
  private readonly users = new Map<string, UserRow>();
  private readonly workspaces = new Map<string, WorkspaceRow>();
  private readonly memberships = new Map<string, MembershipRow>();
  private readonly invitations = new Map<string, InvitationRow>();
  private readonly projects = new Map<string, ProjectRow>();
  private readonly documents = new Map<string, DocumentRow>();
  private readonly documentShares = new Map<string, DocumentShareRow>();
  private readonly activity: ActivityRow[] = [];
  private nextWorkspace = 1;
  private nextInvitation = 1;
  private nextProject = 1;
  private nextActivity = 1;
  private tick = 0;

  async query<T>(sql: string, values: readonly unknown[] = []) {
    return { rows: this.dispatch(sql, values) as T[] };
  }

  private dispatch(sql: string, values: readonly unknown[]): unknown[] {
    if (/insert into users/.test(sql)) {
      return [this.upsertUser(values)];
    }

    if (/insert into activity_entries/.test(sql)) {
      return [this.recordActivity(values)];
    }

    if (/with new_workspace/.test(sql)) {
      return [this.createWorkspace(values)];
    }

    if (
      /select id, name, created_by_sub, created_at, updated_at\s+from workspaces/.test(
        sql,
      )
    ) {
      return rows(this.workspaces.get(stringValue(values[0])));
    }

    if (/join users u on u.sub = wm.user_sub/.test(sql)) {
      return rows(this.shareRecipient(values));
    }

    if (/from workspace_memberships/.test(sql) && /select role/.test(sql)) {
      return rows(
        this.memberships.get(membershipKey(values[0], values[1])),
      ).map((membership) => ({ role: membership.role }));
    }

    if (/from workspace_memberships/.test(sql)) {
      return [...this.memberships.values()]
        .filter((membership) => membership.workspace_id === values[0])
        .sort((left, right) => roleRank(left.role) - roleRank(right.role));
    }

    if (/insert into workspace_invitations/.test(sql)) {
      return [this.createInvitation(values)];
    }

    if (
      /from workspace_invitations/.test(sql) &&
      /where token_hash = \$1/.test(sql)
    ) {
      return rows(
        [...this.invitations.values()].find(
          (invitation) => invitation.token_hash === values[0],
        ),
      );
    }

    if (/with accepted_invitation/.test(sql)) {
      return [this.acceptInvitation(values)];
    }

    if (/insert into projects/.test(sql)) {
      return [this.createProject(values)];
    }

    if (/from projects\s+where workspace_id = \$1\s+and id = \$2/.test(sql)) {
      const project = this.projects.get(stringValue(values[1]));
      return project?.workspace_id === values[0] ? [project] : [];
    }

    if (/from projects\s+where workspace_id = \$1/.test(sql)) {
      return [...this.projects.values()].filter(
        (project) => project.workspace_id === values[0],
      );
    }

    if (/from project_shares/.test(sql)) {
      return [];
    }

    if (/insert into project_documents/.test(sql)) {
      return [this.createDocument(values)];
    }

    if (/from project_documents/.test(sql) && /and id = \$3/.test(sql)) {
      const document = this.documents.get(stringValue(values[2]));
      return document &&
        document.workspace_id === values[0] &&
        document.project_id === values[1]
        ? [document]
        : [];
    }

    if (
      /from project_document_shares/.test(sql) &&
      /select document_id/.test(sql)
    ) {
      return rows(
        this.documentShares.get(documentShareKey(values[0], values[1])),
      ).map((share) => ({ document_id: share.document_id }));
    }

    if (/insert into project_document_shares/.test(sql)) {
      return [this.createDocumentShare(values)];
    }

    if (/from activity_entries/.test(sql)) {
      return this.listActivity(values);
    }

    throw new Error(`Unexpected query: ${sql}`);
  }

  private upsertUser(values: readonly unknown[]): UserRow {
    const sub = stringValue(values[0]);
    const existing = this.users.get(sub);
    const now = this.now();
    const row: UserRow = {
      sub,
      email: stringValue(values[1]),
      email_verified: Boolean(values[2]),
      name: stringOrNull(values[3]),
      picture_url: stringOrNull(values[4]),
      password_hash: existing?.password_hash ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      last_seen_at: now,
      inserted: !existing,
    };

    this.users.set(sub, row);
    return row;
  }

  private createWorkspace(values: readonly unknown[]): WorkspaceRow {
    const now = this.now();
    const workspace: WorkspaceRow = {
      id: `workspace-${this.nextWorkspace++}`,
      name: stringValue(values[0]),
      created_by_sub: stringValue(values[1]),
      created_at: now,
      updated_at: now,
    };
    this.workspaces.set(workspace.id, workspace);
    this.memberships.set(
      membershipKey(workspace.id, workspace.created_by_sub),
      {
        workspace_id: workspace.id,
        user_sub: workspace.created_by_sub,
        role: 'owner',
        created_at: now,
        updated_at: now,
      },
    );
    return workspace;
  }

  private createInvitation(values: readonly unknown[]): InvitationRow {
    const now = this.now();
    const invitation: InvitationRow = {
      id: `invite-${this.nextInvitation++}`,
      workspace_id: stringValue(values[0]),
      email: stringValue(values[1]),
      role: values[2] as WorkspaceInviteRole,
      token_hash: stringValue(values[3]),
      invited_by_sub: stringValue(values[4]),
      created_at: now,
      updated_at: now,
      expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      accepted_at: null,
      revoked_at: null,
    };
    this.invitations.set(invitation.id, invitation);
    return invitation;
  }

  private acceptInvitation(values: readonly unknown[]) {
    const invitation = this.invitations.get(stringValue(values[0]));
    if (!invitation || invitation.accepted_at || invitation.revoked_at) {
      return null;
    }

    const now = this.now();
    invitation.accepted_at = now;
    invitation.updated_at = now;
    const membership: MembershipRow = {
      workspace_id: invitation.workspace_id,
      user_sub: stringValue(values[1]),
      role: invitation.role,
      created_at: now,
      updated_at: now,
    };
    this.memberships.set(
      membershipKey(membership.workspace_id, membership.user_sub),
      membership,
    );

    return {
      ...invitation,
      member_workspace_id: membership.workspace_id,
      member_user_sub: membership.user_sub,
      member_role: membership.role,
      member_created_at: membership.created_at,
      member_updated_at: membership.updated_at,
    };
  }

  private createProject(values: readonly unknown[]): ProjectRow {
    const now = this.now();
    const project: ProjectRow = {
      id: `project-${this.nextProject++}`,
      workspace_id: stringValue(values[0]),
      name: stringValue(values[1]),
      description: stringOrNull(values[2]),
      created_at: now,
      updated_at: now,
    };
    this.projects.set(project.id, project);
    return project;
  }

  private createDocument(values: readonly unknown[]): DocumentRow {
    const document: DocumentRow = {
      id: stringValue(values[0]),
      workspace_id: stringValue(values[1]),
      project_id: stringValue(values[2]),
      file_name: stringValue(values[3]),
      content_type: stringValue(values[4]),
      size_bytes: numberValue(values[5]),
      uploader_sub: stringValue(values[6]),
      storage_key: stringValue(values[7]),
      uploaded_at: this.now(),
    };
    this.documents.set(document.id, document);
    return document;
  }

  private shareRecipient(values: readonly unknown[]) {
    const membership = this.memberships.get(
      membershipKey(values[0], values[1]),
    );
    const user = this.users.get(stringValue(values[1]));
    const workspace = this.workspaces.get(stringValue(values[0]));

    if (!membership || !user || !workspace) {
      return null;
    }

    return {
      user_sub: membership.user_sub,
      email: user.email,
      name: user.name,
      role: membership.role,
      workspace_name: workspace.name,
    };
  }

  private createDocumentShare(values: readonly unknown[]): DocumentShareRow {
    const key = documentShareKey(values[0], values[3]);
    const existing = this.documentShares.get(key);
    const share: DocumentShareRow = {
      document_id: stringValue(values[0]),
      workspace_id: stringValue(values[1]),
      project_id: stringValue(values[2]),
      user_sub: stringValue(values[3]),
      shared_by_sub: stringValue(values[4]),
      created_at: existing?.created_at ?? this.now(),
      inserted: !existing,
    };
    this.documentShares.set(key, share);
    return share;
  }

  private recordActivity(values: readonly unknown[]): ActivityRow {
    const activity: ActivityRow = {
      id: `activity-${this.nextActivity++}`,
      actor_sub: stringValue(values[0]),
      action: stringValue(values[1]),
      workspace_id: stringOrNull(values[2]),
      project_id: stringOrNull(values[3]),
      document_id: stringOrNull(values[4]),
      metadata: JSON.parse(stringValue(values[5])) as Record<string, unknown>,
      created_at: this.now(),
    };
    this.activity.push(activity);
    return activity;
  }

  private listActivity(values: readonly unknown[]): ActivityRow[] {
    const workspaceId = stringValue(values[0]);
    const limit = numberValue(values[1]);
    const offset = numberValue(values[2]);
    const projectId = stringOrNull(values[3]);

    return this.activity
      .filter(
        (entry) =>
          entry.workspace_id === workspaceId &&
          (!projectId || entry.project_id === projectId),
      )
      .sort(
        (left, right) => right.created_at.getTime() - left.created_at.getTime(),
      )
      .slice(offset, offset + limit);
  }

  private now(): Date {
    this.tick += 1;
    return new Date(Date.UTC(2026, 6, 19, 0, 0, this.tick));
  }
}

class JourneyStorage implements ObjectStorage {
  readonly puts: PutObjectInput[] = [];
  private readonly objects = new Map<string, StoredObject>();

  async putObject(input: PutObjectInput): Promise<void> {
    this.puts.push(input);
    this.objects.set(input.key, {
      body: Buffer.from(input.body),
      contentType: input.contentType,
      contentLength: input.body.byteLength,
    });
  }

  async getObject(key: string): Promise<StoredObject> {
    const object = this.objects.get(key);
    if (!object) {
      throw new Error(`Missing object: ${key}`);
    }

    return object;
  }
}

async function withServer(
  app: express.Express,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = app.listen(0);
  try {
    const address = server.address() as AddressInfo;
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function getJson<T>(url: string, cookieHeader: string): Promise<T> {
  const response = await fetch(url, { headers: { cookie: cookieHeader } });
  if (response.status !== 200) {
    assert.fail(await response.text());
  }

  return (await response.json()) as T;
}

async function postJson<T>(
  url: string,
  cookieHeader: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      cookie: cookieHeader,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (response.status < 200 || response.status >= 300) {
    assert.fail(await response.text());
  }

  return (await response.json()) as T;
}

async function inviteUser(
  baseUrl: string,
  cookieHeader: string,
  input: { workspaceId: string; email: string; role: WorkspaceInviteRole },
) {
  return postJson<{
    invitation: { role: WorkspaceInviteRole; email: string };
  }>(
    `${baseUrl}/api/workspaces/${input.workspaceId}/invitations`,
    cookieHeader,
    {
      email: input.email,
      role: input.role,
    },
  );
}

async function uploadDocument(
  baseUrl: string,
  cookieHeader: string,
  input: {
    workspaceId: string;
    projectId: string;
    fileName: string;
    contentType: string;
    body: Buffer;
  },
) {
  const response = await fetch(
    `${baseUrl}/api/workspaces/${input.workspaceId}/projects/${input.projectId}/documents`,
    {
      method: 'POST',
      headers: {
        cookie: cookieHeader,
        'content-type': input.contentType,
        'x-file-name': input.fileName,
      },
      body: input.body,
    },
  );
  if (response.status !== 201) {
    assert.fail(await response.text());
  }

  return (await response.json()) as {
    document: { id: string; contentType: string };
  };
}

function cookie(token: string): string {
  return `mctai_session=${token}`;
}

function rows<T>(row: T | null | undefined): T[] {
  return row ? [row] : [];
}

function membershipKey(workspaceId: unknown, userSub: unknown): string {
  return `${stringValue(workspaceId)}:${stringValue(userSub)}`;
}

function documentShareKey(documentId: unknown, userSub: unknown): string {
  return `${stringValue(documentId)}:${stringValue(userSub)}`;
}

function roleRank(role: WorkspaceRole): number {
  return role === 'owner' ? 1 : role === 'member' ? 2 : 3;
}

function stringValue(value: unknown): string {
  assert.equal(typeof value, 'string');
  return value as string;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number {
  assert.equal(typeof value === 'number' || typeof value === 'string', true);
  return Number(value);
}
