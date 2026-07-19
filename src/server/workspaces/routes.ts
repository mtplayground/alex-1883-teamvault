import { Router, type Request, type Response } from 'express';

import type { AuthConfig } from '../config.js';
import { requireAuth, type AuthenticatedLocals } from '../auth/middleware.js';
import { getPool } from '../db/pool.js';
import type { MctaiJwtVerifier } from '../auth/session.js';
import {
  createWorkspace,
  getWorkspaceDetails,
  requireWorkspaceMembership,
  requireWorkspaceOwner,
  updateWorkspaceSettings,
  WorkspaceNotFoundError,
  WorkspacePermissionError,
  type WorkspaceDetails,
  type WorkspaceQueryable,
} from './store.js';

export interface WorkspaceRouterOptions {
  authConfig: AuthConfig | null;
  db?: WorkspaceQueryable;
  verifier?: MctaiJwtVerifier;
}

class WorkspaceValidationError extends Error {}

export function createWorkspaceRouter({
  authConfig,
  db = getPool(),
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

function currentUserSub(res: Response): string {
  return (res.locals as AuthenticatedLocals).currentUser.sub;
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

  if (
    error instanceof WorkspaceValidationError ||
    (error instanceof Error && /workspace name is required/.test(error.message))
  ) {
    res.status(400).json({ error: error.message });
    return;
  }

  next(error);
}
