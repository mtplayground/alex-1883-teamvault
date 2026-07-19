import { Router, type Request } from 'express';

import type { AuthConfig } from '../config.js';
import { getPool } from '../db/pool.js';
import {
  upsertUserAccount,
  type UserAccountQueryable,
} from '../users/model.js';
import { verifySessionCookie, type MctaiJwtVerifier } from './session.js';
import type { AuthSessionResponse } from '../../shared/auth.js';

export interface AuthRouterOptions {
  authConfig: AuthConfig | null;
  selfUrl?: string | null;
  db?: UserAccountQueryable;
  verifier?: MctaiJwtVerifier;
}

export function createAuthRouter({
  authConfig,
  selfUrl,
  db = getPool(),
  verifier,
}: AuthRouterOptions): Router {
  const router = Router();

  router.get('/login', (req, res) => {
    if (!authConfig) {
      res.status(503).json({ error: 'Authentication is not configured' });
      return;
    }

    res.redirect(
      302,
      buildAuthLoginUrl(authConfig, getReturnToUrl(req, selfUrl)),
    );
  });

  router.post('/register', (req, res) => {
    if (!authConfig) {
      res.status(503).json({ error: 'Authentication is not configured' });
      return;
    }

    res.redirect(
      303,
      buildAuthLoginUrl(authConfig, getReturnToUrl(req, selfUrl)),
    );
  });

  router.get('/verify', (req, res) => {
    if (!authConfig) {
      res.status(503).json({ error: 'Authentication is not configured' });
      return;
    }

    res.redirect(
      302,
      buildAuthLoginUrl(authConfig, getReturnToUrl(req, selfUrl)),
    );
  });

  router.get('/session', async (req, res, next) => {
    try {
      if (!authConfig) {
        res.status(503).json({ error: 'Authentication is not configured' });
        return;
      }

      const userInput = await verifySessionCookie(
        req.headers.cookie,
        authConfig,
        verifier,
      );

      if (!userInput) {
        res.status(401).json({ user: null });
        return;
      }

      const result = await upsertUserAccount(db, userInput);
      const body: AuthSessionResponse = {
        user: {
          sub: result.user.sub,
          email: result.user.email,
          emailVerified: result.user.emailVerified,
          name: result.user.name,
          pictureUrl: result.user.pictureUrl,
        },
        isNew: result.isNew,
        message: result.isNew
          ? 'Registration complete.'
          : `Welcome back, ${result.user.name ?? result.user.email}.`,
      };

      res.json(body);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function buildAuthLoginUrl(
  authConfig: AuthConfig,
  returnTo: string,
): string {
  const url = new URL('/login', authConfig.url);
  url.searchParams.set('app_token', authConfig.appToken);
  url.searchParams.set('return_to', returnTo);

  return url.toString();
}

function getReturnToUrl(
  req: Request,
  configuredSelfUrl: string | null | undefined,
) {
  const selfUrl = configuredSelfUrl ?? `${req.protocol}://${req.get('host')}`;
  return new URL('/', selfUrl).toString();
}
