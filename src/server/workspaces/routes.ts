import { Router, type Request, type Response } from 'express';

import type { AuthConfig, EmailConfig } from '../config.js';
import { requireAuth, type AuthenticatedLocals } from '../auth/middleware.js';
import { getPool } from '../db/pool.js';
import {
  createEmailClient,
  type EmailSendResult,
  type SendEmailInput,
} from '../email/client.js';
import { createEmailTemplates } from '../email/templates.js';
import type { MctaiJwtVerifier } from '../auth/session.js';
import {
  createWorkspace,
  getWorkspaceDetails,
  issueWorkspaceInvitation,
  listPendingWorkspaceInvitations,
  requireWorkspaceMembership,
  requireWorkspaceOwner,
  revokeWorkspaceInvitation,
  updateWorkspaceSettings,
  acceptWorkspaceInvitation,
  WorkspaceInvitationError,
  WorkspaceNotFoundError,
  WorkspacePermissionError,
  type InvitationTokenGenerator,
  type WorkspaceDetails,
  type WorkspaceQueryable,
} from './store.js';
import type { WorkspaceInvitation, WorkspaceInviteRole } from './model.js';

export interface WorkspaceRouterOptions {
  authConfig: AuthConfig | null;
  emailConfig?: EmailConfig | null;
  selfUrl?: string | null;
  db?: WorkspaceQueryable;
  emailSender?: WorkspaceEmailSender;
  invitationTokenGenerator?: InvitationTokenGenerator;
  verifier?: MctaiJwtVerifier;
}

export interface WorkspaceEmailSender {
  send(input: SendEmailInput): Promise<EmailSendResult>;
}

class WorkspaceValidationError extends Error {}

export function createWorkspaceRouter({
  authConfig,
  emailConfig = null,
  selfUrl = null,
  db = getPool(),
  emailSender = createEmailClient({ config: emailConfig }),
  invitationTokenGenerator,
  verifier,
}: WorkspaceRouterOptions): Router {
  const router = Router();

  router.use(requireAuth({ authConfig, db, verifier }));

  router.post('/', async (req, res, next) => {
    try {
      const workspace = await createWorkspace(db, {
        name: readBodyString(req, 'name'),
        createdBySub: currentUserSub(res),
      });
      const details = await getWorkspaceDetails(db, workspace.id);

      res.status(201).json(workspaceDetailsResponse(details));
    } catch (error) {
      handleWorkspaceError(error, res, next);
    }
  });

  router.post('/invitations/accept', async (req, res, next) => {
    try {
      const currentUser = currentUserLocals(res).currentUser;
      const result = await acceptWorkspaceInvitation(db, {
        token: readBodyString(req, 'token'),
        userSub: currentUser.sub,
        userEmail: currentUser.email,
      });

      res.json({
        invitation: invitationResponse(result.invitation),
        membership: {
          workspaceId: result.membership.workspaceId,
          userSub: result.membership.userSub,
          role: result.membership.role,
          createdAt: result.membership.createdAt.toISOString(),
          updatedAt: result.membership.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      handleWorkspaceError(error, res, next);
    }
  });

  router.post('/:workspaceId/invitations', async (req, res, next) => {
    try {
      const workspaceId = req.params.workspaceId;
      const currentUser = currentUserLocals(res);

      await requireWorkspaceOwner(db, workspaceId, currentUser.currentUser.sub);

      const details = await getWorkspaceDetails(db, workspaceId);
      const invitationResult = await issueWorkspaceInvitation(db, {
        workspaceId,
        email: readBodyString(req, 'email'),
        role: readInviteRole(req),
        invitedBySub: currentUser.currentUser.sub,
        tokenGenerator: invitationTokenGenerator,
      });
      const template = createEmailTemplates({
        baseUrl: selfUrl ?? `${req.protocol}://${req.get('host')}`,
        brandName: details.workspace.name,
      }).workspaceInvitation({
        inviterName:
          currentUser.currentUser.name ?? currentUser.currentUser.email,
        workspaceName: details.workspace.name,
        token: invitationResult.token,
        expiresIn: 'in 7 days',
      });
      const email = await emailSender.send({
        to: invitationResult.invitation.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      });

      res.status(201).json({
        invitation: invitationResponse(invitationResult.invitation),
        email,
      });
    } catch (error) {
      handleWorkspaceError(error, res, next);
    }
  });

  router.get('/:workspaceId/invitations', async (req, res, next) => {
    try {
      const workspaceId = req.params.workspaceId;
      await requireWorkspaceOwner(db, workspaceId, currentUserSub(res));
      const invitations = await listPendingWorkspaceInvitations(
        db,
        workspaceId,
      );

      res.json({
        invitations: invitations.map(invitationResponse),
      });
    } catch (error) {
      handleWorkspaceError(error, res, next);
    }
  });

  router.delete(
    '/:workspaceId/invitations/:invitationId',
    async (req, res, next) => {
      try {
        const workspaceId = req.params.workspaceId;
        await requireWorkspaceOwner(db, workspaceId, currentUserSub(res));
        const invitation = await revokeWorkspaceInvitation(
          db,
          workspaceId,
          req.params.invitationId,
        );

        res.json({ invitation: invitationResponse(invitation) });
      } catch (error) {
        handleWorkspaceError(error, res, next);
      }
    },
  );

  router.get('/:workspaceId', async (req, res, next) => {
    try {
      const workspaceId = req.params.workspaceId;
      await requireWorkspaceMembership(db, workspaceId, currentUserSub(res));
      const details = await getWorkspaceDetails(db, workspaceId);

      res.json(workspaceDetailsResponse(details));
    } catch (error) {
      handleWorkspaceError(error, res, next);
    }
  });

  router.patch('/:workspaceId', async (req, res, next) => {
    try {
      const workspaceId = req.params.workspaceId;
      await requireWorkspaceOwner(db, workspaceId, currentUserSub(res));
      await updateWorkspaceSettings(db, workspaceId, {
        name: readBodyString(req, 'name'),
      });
      const details = await getWorkspaceDetails(db, workspaceId);

      res.json(workspaceDetailsResponse(details));
    } catch (error) {
      handleWorkspaceError(error, res, next);
    }
  });

  return router;
}

function workspaceDetailsResponse(details: WorkspaceDetails) {
  return {
    workspace: {
      id: details.workspace.id,
      name: details.workspace.name,
      createdBySub: details.workspace.createdBySub,
      createdAt: details.workspace.createdAt.toISOString(),
      updatedAt: details.workspace.updatedAt.toISOString(),
    },
    members: details.members.map((member) => ({
      workspaceId: member.workspaceId,
      userSub: member.userSub,
      role: member.role,
      createdAt: member.createdAt.toISOString(),
      updatedAt: member.updatedAt.toISOString(),
    })),
  };
}

function invitationResponse(invitation: WorkspaceInvitation) {
  return {
    id: invitation.id,
    workspaceId: invitation.workspaceId,
    email: invitation.email,
    role: invitation.role,
    invitedBySub: invitation.invitedBySub,
    createdAt: invitation.createdAt.toISOString(),
    updatedAt: invitation.updatedAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    revokedAt: invitation.revokedAt?.toISOString() ?? null,
  };
}

function currentUserLocals(res: Response): AuthenticatedLocals {
  return res.locals as AuthenticatedLocals;
}

function currentUserSub(res: Response): string {
  return currentUserLocals(res).currentUser.sub;
}

function readBodyString(req: Request, key: string): string {
  const body =
    typeof req.body === 'object' && req.body !== null
      ? (req.body as Record<string, unknown>)
      : {};
  const value = body[key];

  if (typeof value !== 'string') {
    throw new WorkspaceValidationError(`${key} is required`);
  }

  return value;
}

function readInviteRole(req: Request): WorkspaceInviteRole {
  const value = readBodyString(req, 'role');

  if (value === 'member' || value === 'guest') {
    return value;
  }

  throw new WorkspaceValidationError('role must be member or guest');
}

function handleWorkspaceError(
  error: unknown,
  res: Response,
  next: (error?: unknown) => void,
): void {
  if (error instanceof WorkspaceNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }

  if (error instanceof WorkspacePermissionError) {
    res.status(403).json({ error: error.message });
    return;
  }

  if (error instanceof WorkspaceInvitationError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  if (
    error instanceof WorkspaceValidationError ||
    (error instanceof Error &&
      /(workspace name is required|email must be a valid email address|unsupported workspace invitation role)/.test(
        error.message,
      ))
  ) {
    res.status(400).json({ error: error.message });
    return;
  }

  next(error);
}
