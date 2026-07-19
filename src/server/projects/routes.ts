import {
  Router,
  raw,
  type ErrorRequestHandler,
  type Request,
  type Response,
} from 'express';

import type { AuthConfig, EmailConfig, StorageConfig } from '../config.js';
import { requireAuth, type AuthenticatedLocals } from '../auth/middleware.js';
import { getPool } from '../db/pool.js';
import type { MctaiJwtVerifier } from '../auth/session.js';
import { requireWorkspaceMembership } from '../workspaces/store.js';
import { parseWorkspaceRole, type WorkspaceRole } from '../workspaces/model.js';
import { roleCan } from '../workspaces/permissions.js';
import {
  saveProjectDocument,
  type RetrievedProjectDocument,
} from '../documents/service.js';
import type {
  ProjectDocument,
  ProjectDocumentShare,
} from '../documents/model.js';
import {
  createProjectDocumentShare,
  deleteProjectDocumentShare,
  getProjectDocument,
  isProjectDocumentSharedWithUser,
  listProjectDocumentShares,
  listProjectDocuments,
  listProjectDocumentsSharedWithUser,
  ProjectDocumentNotFoundError,
} from '../documents/store.js';
import {
  roleCanAccessDocument,
  roleCanAccessProjectDocuments,
  roleCanShareDocument,
} from '../documents/permissions.js';
import {
  createEmailClient,
  type EmailSendResult,
  type SendEmailInput,
} from '../email/client.js';
import { createEmailTemplates } from '../email/templates.js';
import { S3ObjectStorage, type ObjectStorage } from '../storage/s3.js';
import {
  roleCanCreateProject,
  roleCanDeleteProject,
  roleCanEditProject,
} from './permissions.js';
import {
  createProject,
  deleteProject,
  getProjectForRole,
  listProjectsForRole,
  ProjectNotFoundError,
  ProjectPermissionError,
  updateProject,
  type ProjectQueryable,
} from './store.js';
import type { Project } from './model.js';

export interface ProjectRouterOptions {
  authConfig: AuthConfig | null;
  emailConfig?: EmailConfig | null;
  selfUrl?: string | null;
  storageConfig?: StorageConfig | null;
  storage?: ObjectStorage | null;
  db?: ProjectQueryable;
  emailSender?: ProjectEmailSender;
  verifier?: MctaiJwtVerifier;
}

export interface ProjectEmailSender {
  send(input: SendEmailInput): Promise<EmailSendResult>;
}

class ProjectValidationError extends Error {}
class ProjectUnsupportedMediaTypeError extends Error {}
class ProjectPayloadTooLargeError extends Error {}
class ProjectStorageUnavailableError extends Error {
  constructor() {
    super('Document storage is not configured');
  }
}

const maxDocumentUploadBytes = 10 * 1024 * 1024;
const acceptedDocumentContentTypes = new Set([
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function createProjectRouter({
  authConfig,
  emailConfig = null,
  selfUrl = null,
  storageConfig,
  storage,
  db = getPool(),
  emailSender = createEmailClient({ config: emailConfig }),
  verifier,
}: ProjectRouterOptions): Router {
  const router = Router();
  const objectStorage =
    storage ?? (storageConfig ? new S3ObjectStorage(storageConfig) : null);

  router.use(requireAuth({ authConfig, db, verifier }));

  router.post('/:workspaceId/projects', async (req, res, next) => {
    try {
      const workspaceId = req.params.workspaceId;
      const currentUser = currentUserLocals(res);
      const role = await requireWorkspaceMembership(
        db,
        workspaceId,
        currentUser.currentUser.sub,
      );

      requireProjectWriteRole(role);

      const project = await createProject(db, {
        workspaceId,
        name: readBodyString(req, 'name'),
        description: readOptionalBodyString(req, 'description'),
      });

      res.status(201).json({ project: projectResponse(project) });
    } catch (error) {
      handleProjectError(error, res, next);
    }
  });

  router.get('/:workspaceId/projects', async (req, res, next) => {
    try {
      const workspaceId = req.params.workspaceId;
      const currentUser = currentUserLocals(res);
      const role = await requireWorkspaceMembership(
        db,
        workspaceId,
        currentUser.currentUser.sub,
      );
      const projects = await listProjectsForRole(db, {
        workspaceId,
        userSub: currentUser.currentUser.sub,
        role,
      });

      res.json({ projects: projects.map(projectResponse) });
    } catch (error) {
      handleProjectError(error, res, next);
    }
  });

  router.post(
    '/:workspaceId/projects/:projectId/documents',
    raw({
      type: () => true,
      limit: maxDocumentUploadBytes,
    }),
    async (req, res, next) => {
      try {
        const workspaceId = req.params.workspaceId;
        const projectId = req.params.projectId;
        const currentUser = currentUserLocals(res);
        const role = await requireWorkspaceMembership(
          db,
          workspaceId,
          currentUser.currentUser.sub,
        );

        if (!roleCan(role, 'upload_documents')) {
          throw new ProjectPermissionError('Guests cannot upload documents');
        }

        await getProjectForRole(db, {
          workspaceId,
          projectId,
          userSub: currentUser.currentUser.sub,
          role,
        });

        const fileName = readUploadFileName(req);
        const contentType = readUploadContentType(req);
        const body = readUploadBody(req);

        if (!objectStorage) {
          throw new ProjectStorageUnavailableError();
        }

        const document = await saveProjectDocument(db, objectStorage, {
          workspaceId,
          projectId,
          uploaderSub: currentUser.currentUser.sub,
          fileName,
          contentType,
          body,
        });

        res.status(201).json({ document: documentResponse(document) });
      } catch (error) {
        handleProjectError(error, res, next);
      }
    },
  );

  router.get(
    '/:workspaceId/projects/:projectId/documents',
    async (req, res, next) => {
      try {
        const workspaceId = req.params.workspaceId;
        const projectId = req.params.projectId;
        const currentUser = currentUserLocals(res);
        const role = await requireWorkspaceMembership(
          db,
          workspaceId,
          currentUser.currentUser.sub,
        );

        await getProjectForRole(db, {
          workspaceId,
          projectId,
          userSub: currentUser.currentUser.sub,
          role,
        });

        const documents = roleCanAccessProjectDocuments(role)
          ? await listProjectDocuments(db, {
              workspaceId,
              projectId,
            })
          : await listProjectDocumentsSharedWithUser(db, {
              workspaceId,
              projectId,
              userSub: currentUser.currentUser.sub,
            });

        res.json({ documents: documents.map(documentResponse) });
      } catch (error) {
        handleProjectError(error, res, next);
      }
    },
  );

  router.get(
    '/:workspaceId/projects/:projectId/documents/:documentId/shares',
    async (req, res, next) => {
      try {
        const workspaceId = req.params.workspaceId;
        const projectId = req.params.projectId;
        const documentId = req.params.documentId;
        const currentUser = currentUserLocals(res);
        const role = await requireWorkspaceMembership(
          db,
          workspaceId,
          currentUser.currentUser.sub,
        );
        await getProjectDocument(db, {
          workspaceId,
          projectId,
          documentId,
        });
        const hasProjectAccess = await canAccessProject(db, {
          workspaceId,
          projectId,
          userSub: currentUser.currentUser.sub,
          role,
        });

        if (!roleCanShareDocument(role, { hasProjectAccess })) {
          throw new ProjectPermissionError(
            'Only project owners and members can share documents',
          );
        }

        const shares = await listProjectDocumentShares(db, { documentId });

        res.json({ shares: shares.map(documentShareResponse) });
      } catch (error) {
        handleProjectError(error, res, next);
      }
    },
  );

  router.post(
    '/:workspaceId/projects/:projectId/documents/:documentId/shares',
    async (req, res, next) => {
      try {
        const workspaceId = req.params.workspaceId;
        const projectId = req.params.projectId;
        const documentId = req.params.documentId;
        const currentUser = currentUserLocals(res);
        const role = await requireWorkspaceMembership(
          db,
          workspaceId,
          currentUser.currentUser.sub,
        );
        const document = await getProjectDocument(db, {
          workspaceId,
          projectId,
          documentId,
        });
        const hasProjectAccess = await canAccessProject(db, {
          workspaceId,
          projectId,
          userSub: currentUser.currentUser.sub,
          role,
        });

        if (!roleCanShareDocument(role, { hasProjectAccess })) {
          throw new ProjectPermissionError(
            'Only project owners and members can share documents',
          );
        }

        const targetUserSub = readBodyString(req, 'userSub');
        const recipient = await getWorkspaceShareRecipient(db, {
          workspaceId,
          userSub: targetUserSub,
        });
        const shareResult = await createProjectDocumentShare(db, {
          documentId: document.id,
          workspaceId,
          projectId,
          userSub: recipient.userSub,
          sharedBySub: currentUser.currentUser.sub,
        });
        const email = shareResult.isNew
          ? await sendDocumentSharedEmail({
              req,
              selfUrl,
              emailSender,
              currentUser: currentUser.currentUser,
              recipient,
              document,
            })
          : null;

        res.status(shareResult.isNew ? 201 : 200).json({
          share: documentShareResponse(shareResult.share),
          email,
        });
      } catch (error) {
        handleProjectError(error, res, next);
      }
    },
  );

  router.delete(
    '/:workspaceId/projects/:projectId/documents/:documentId/shares/:userSub',
    async (req, res, next) => {
      try {
        const workspaceId = req.params.workspaceId;
        const projectId = req.params.projectId;
        const documentId = req.params.documentId;
        const currentUser = currentUserLocals(res);
        const role = await requireWorkspaceMembership(
          db,
          workspaceId,
          currentUser.currentUser.sub,
        );
        const document = await getProjectDocument(db, {
          workspaceId,
          projectId,
          documentId,
        });
        const hasProjectAccess = await canAccessProject(db, {
          workspaceId,
          projectId,
          userSub: currentUser.currentUser.sub,
          role,
        });

        if (!roleCanShareDocument(role, { hasProjectAccess })) {
          throw new ProjectPermissionError(
            'Only project owners and members can share documents',
          );
        }

        await deleteProjectDocumentShare(db, {
          documentId: document.id,
          userSub: req.params.userSub,
        });

        res.status(204).end();
      } catch (error) {
        handleProjectError(error, res, next);
      }
    },
  );

  router.get(
    '/:workspaceId/projects/:projectId/documents/:documentId/download',
    async (req, res, next) => {
      try {
        const retrievedDocument = await retrieveAuthorizedProjectDocument({
          db,
          storage: objectStorage,
          req,
          res,
        });

        sendDocumentFile(res, retrievedDocument, 'attachment');
      } catch (error) {
        handleProjectError(error, res, next);
      }
    },
  );

  router.get(
    '/:workspaceId/projects/:projectId/documents/:documentId',
    async (req, res, next) => {
      try {
        const retrievedDocument = await retrieveAuthorizedProjectDocument({
          db,
          storage: objectStorage,
          req,
          res,
        });

        sendDocumentFile(res, retrievedDocument, 'inline');
      } catch (error) {
        handleProjectError(error, res, next);
      }
    },
  );

  router.get('/:workspaceId/projects/:projectId', async (req, res, next) => {
    try {
      const workspaceId = req.params.workspaceId;
      const currentUser = currentUserLocals(res);
      const role = await requireWorkspaceMembership(
        db,
        workspaceId,
        currentUser.currentUser.sub,
      );
      const project = await getProjectForRole(db, {
        workspaceId,
        projectId: req.params.projectId,
        userSub: currentUser.currentUser.sub,
        role,
      });

      res.json({ project: projectResponse(project) });
    } catch (error) {
      handleProjectError(error, res, next);
    }
  });

  router.patch('/:workspaceId/projects/:projectId', async (req, res, next) => {
    try {
      const workspaceId = req.params.workspaceId;
      const currentUser = currentUserLocals(res);
      const role = await requireWorkspaceMembership(
        db,
        workspaceId,
        currentUser.currentUser.sub,
      );

      if (!roleCanEditProject(role)) {
        throw new ProjectPermissionError('Guests cannot edit projects');
      }

      const project = await updateProject(db, {
        workspaceId,
        projectId: req.params.projectId,
        name: readBodyString(req, 'name'),
        description: readOptionalBodyString(req, 'description'),
      });

      res.json({ project: projectResponse(project) });
    } catch (error) {
      handleProjectError(error, res, next);
    }
  });

  router.delete('/:workspaceId/projects/:projectId', async (req, res, next) => {
    try {
      const workspaceId = req.params.workspaceId;
      const currentUser = currentUserLocals(res);
      const role = await requireWorkspaceMembership(
        db,
        workspaceId,
        currentUser.currentUser.sub,
      );

      if (!roleCanDeleteProject(role)) {
        throw new ProjectPermissionError('Guests cannot delete projects');
      }

      await deleteProject(db, {
        workspaceId,
        projectId: req.params.projectId,
      });

      res.status(204).end();
    } catch (error) {
      handleProjectError(error, res, next);
    }
  });

  router.use(uploadParserErrorHandler);

  return router;
}

function requireProjectWriteRole(role: WorkspaceRole): void {
  if (!roleCanCreateProject(role)) {
    throw new ProjectPermissionError('Guests cannot create projects');
  }
}

function projectResponse(project: Project) {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function documentResponse(document: ProjectDocument) {
  return {
    id: document.id,
    workspaceId: document.workspaceId,
    projectId: document.projectId,
    fileName: document.fileName,
    contentType: document.contentType,
    sizeBytes: document.sizeBytes,
    uploaderSub: document.uploaderSub,
    uploadedAt: document.uploadedAt.toISOString(),
  };
}

function documentShareResponse(share: ProjectDocumentShare) {
  return {
    documentId: share.documentId,
    workspaceId: share.workspaceId,
    projectId: share.projectId,
    userSub: share.userSub,
    sharedBySub: share.sharedBySub,
    createdAt: share.createdAt.toISOString(),
  };
}

function currentUserLocals(res: Response): AuthenticatedLocals {
  return res.locals as AuthenticatedLocals;
}

function readBodyString(req: Request, key: string): string {
  const body =
    typeof req.body === 'object' && req.body !== null
      ? (req.body as Record<string, unknown>)
      : {};
  const value = body[key];

  if (typeof value !== 'string') {
    throw new ProjectValidationError(`${key} is required`);
  }

  return value;
}

function readOptionalBodyString(req: Request, key: string): string | null {
  const body =
    typeof req.body === 'object' && req.body !== null
      ? (req.body as Record<string, unknown>)
      : {};
  const value = body[key];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new ProjectValidationError(`${key} must be text`);
  }

  return value;
}

function readUploadFileName(req: Request): string {
  const value = req.header('x-file-name');

  if (!value) {
    throw new ProjectValidationError('x-file-name header is required');
  }

  return value;
}

function readUploadContentType(req: Request): string {
  const contentType = (req.header('content-type') ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase();

  if (!contentType || !acceptedDocumentContentTypes.has(contentType)) {
    throw new ProjectUnsupportedMediaTypeError(
      'Only PDF, PNG, JPEG, GIF, and WebP files are supported',
    );
  }

  return contentType;
}

function readUploadBody(req: Request): Buffer {
  if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
    throw new ProjectValidationError('file body is required');
  }

  if (req.body.byteLength > maxDocumentUploadBytes) {
    throw new ProjectPayloadTooLargeError(
      `File must be ${maxDocumentUploadBytes} bytes or smaller`,
    );
  }

  return req.body;
}

async function retrieveAuthorizedProjectDocument(input: {
  db: ProjectQueryable;
  storage: ObjectStorage | null;
  req: Request;
  res: Response;
}): Promise<RetrievedProjectDocument> {
  const workspaceId = readRouteParam(input.req, 'workspaceId');
  const projectId = readRouteParam(input.req, 'projectId');
  const currentUser = currentUserLocals(input.res);
  const role = await requireWorkspaceMembership(
    input.db,
    workspaceId,
    currentUser.currentUser.sub,
  );
  const document = await getProjectDocument(input.db, {
    workspaceId,
    projectId,
    documentId: readRouteParam(input.req, 'documentId'),
  });
  const hasProjectAccess = await canAccessProject(input.db, {
    workspaceId,
    projectId,
    userSub: currentUser.currentUser.sub,
    role,
  });
  const isDocumentSharedWithUser = hasProjectAccess
    ? false
    : await isProjectDocumentSharedWithUser(input.db, {
        documentId: document.id,
        userSub: currentUser.currentUser.sub,
      });

  if (
    !roleCanAccessDocument(role, {
      hasProjectAccess,
      isDocumentSharedWithUser,
    })
  ) {
    throw new ProjectPermissionError(
      'Documents can only be viewed by project users or explicitly shared users',
    );
  }

  if (!input.storage) {
    throw new ProjectStorageUnavailableError();
  }

  const file = await input.storage.getObject(document.storageKey);

  return { document, file };
}

async function canAccessProject(
  db: ProjectQueryable,
  input: {
    workspaceId: string;
    projectId: string;
    userSub: string;
    role: WorkspaceRole;
  },
): Promise<boolean> {
  try {
    await getProjectForRole(db, input);
    return true;
  } catch (error) {
    if (error instanceof ProjectPermissionError) {
      return false;
    }

    throw error;
  }
}

interface ProjectShareRecipient {
  userSub: string;
  email: string;
  name: string | null;
  role: WorkspaceRole;
  workspaceName: string;
}

interface ProjectShareRecipientRow {
  user_sub: string;
  email: string;
  name: string | null;
  role: string;
  workspace_name: string;
}

async function getWorkspaceShareRecipient(
  db: ProjectQueryable,
  input: { workspaceId: string; userSub: string },
): Promise<ProjectShareRecipient> {
  const result = await db.query<ProjectShareRecipientRow>(
    `
      select
        wm.user_sub,
        u.email,
        u.name,
        wm.role,
        w.name as workspace_name
      from workspace_memberships wm
      join users u on u.sub = wm.user_sub
      join workspaces w on w.id = wm.workspace_id
      where wm.workspace_id = $1
        and wm.user_sub = $2
    `,
    [
      normalizeRequiredText(input.workspaceId, 'workspaceId'),
      normalizeRequiredText(input.userSub, 'userSub'),
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new ProjectValidationError(
      'Share recipient must be a workspace member',
    );
  }

  return {
    userSub: row.user_sub,
    email: row.email,
    name: row.name,
    role: parseWorkspaceRole(row.role),
    workspaceName: row.workspace_name,
  };
}

async function sendDocumentSharedEmail(input: {
  req: Request;
  selfUrl: string | null;
  emailSender: ProjectEmailSender;
  currentUser: AuthenticatedLocals['currentUser'];
  recipient: ProjectShareRecipient;
  document: ProjectDocument;
}): Promise<EmailSendResult> {
  const template = createEmailTemplates({
    baseUrl:
      input.selfUrl ?? `${input.req.protocol}://${input.req.get('host')}`,
    brandName: input.recipient.workspaceName,
  }).documentShared({
    recipientName: input.recipient.name ?? input.recipient.email,
    sharedByName: input.currentUser.name ?? input.currentUser.email,
    documentName: input.document.fileName,
    documentId: input.document.id,
    projectId: input.document.projectId,
    workspaceName: input.recipient.workspaceName,
  });

  return input.emailSender.send({
    to: input.recipient.email,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

function readRouteParam(req: Request, key: string): string {
  const value = req.params[key];

  if (typeof value !== 'string') {
    throw new ProjectValidationError(`${key} is required`);
  }

  return value;
}

function normalizeRequiredText(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new ProjectValidationError(`${field} is required`);
  }

  return normalized;
}

function sendDocumentFile(
  res: Response,
  retrievedDocument: RetrievedProjectDocument,
  disposition: 'inline' | 'attachment',
): void {
  res.setHeader('Content-Type', retrievedDocument.document.contentType);
  res.setHeader(
    'Content-Length',
    String(retrievedDocument.file.body.byteLength),
  );
  res.setHeader('Cache-Control', 'private, max-age=0');
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${escapeDispositionFilename(
      retrievedDocument.document.fileName,
    )}"`,
  );
  res.send(retrievedDocument.file.body);
}

function escapeDispositionFilename(fileName: string): string {
  return fileName.replace(/["\\\r\n]/g, '_');
}

function handleProjectError(
  error: unknown,
  res: Response,
  next: (error?: unknown) => void,
): void {
  if (error instanceof ProjectNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }

  if (error instanceof ProjectDocumentNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }

  if (error instanceof ProjectPermissionError) {
    res.status(403).json({ error: error.message });
    return;
  }

  if (error instanceof ProjectUnsupportedMediaTypeError) {
    res.status(415).json({ error: error.message });
    return;
  }

  if (error instanceof ProjectPayloadTooLargeError) {
    res.status(413).json({ error: error.message });
    return;
  }

  if (error instanceof ProjectStorageUnavailableError) {
    res.status(503).json({ error: error.message });
    return;
  }

  if (
    error instanceof ProjectValidationError ||
    (error instanceof Error && /project name is required/.test(error.message))
  ) {
    res.status(400).json({ error: error.message });
    return;
  }

  next(error);
}

const uploadParserErrorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  next,
) => {
  if (
    error instanceof Error &&
    'type' in error &&
    error.type === 'entity.too.large'
  ) {
    res.status(413).json({
      error: `File must be ${maxDocumentUploadBytes} bytes or smaller`,
    });
    return;
  }

  next(error);
};
