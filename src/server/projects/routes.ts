import { Router, type Request, type Response } from 'express';

import type { AuthConfig } from '../config.js';
import { requireAuth, type AuthenticatedLocals } from '../auth/middleware.js';
import { getPool } from '../db/pool.js';
import type { MctaiJwtVerifier } from '../auth/session.js';
import { requireWorkspaceMembership } from '../workspaces/store.js';
import type { WorkspaceRole } from '../workspaces/model.js';
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
  db?: ProjectQueryable;
  verifier?: MctaiJwtVerifier;
}

class ProjectValidationError extends Error {}

export function createProjectRouter({
  authConfig,
  db = getPool(),
  verifier,
}: ProjectRouterOptions): Router {
  const router = Router();

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

function handleProjectError(
  error: unknown,
  res: Response,
  next: (error?: unknown) => void,
): void {
  if (error instanceof ProjectNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }

  if (error instanceof ProjectPermissionError) {
    res.status(403).json({ error: error.message });
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
