import { Router, type Request } from 'express';

import type { AuthConfig } from '../config.js';
import { getPool } from '../db/pool.js';
import { type UserAccountQueryable } from '../users/model.js';
import {
  authenticateSession,
  type AuthenticationResult,
} from './middleware.js';
import {
  passwordResetCompleteResponse,
  passwordResetRequestResponse,
} from './password-reset.js';
import { type MctaiJwtVerifier } from './session.js';
import { buildAuthLoginUrl } from './urls.js';
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

  router.post('/password-reset/request', (_req, res) => {
    res.status(202).json(passwordResetRequestResponse());
  });

  router.post('/password-reset/complete', (req, res) => {
    if (!authConfig) {
      res.status(503).json({ error: 'Authentication is not configured' });
      return;
    }

    res
      .status(410)
      .json(
        passwordResetCompleteResponse(authConfig, getReturnToUrl(req, selfUrl)),
      );
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie('mctai_session', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
    res.status(204).end();
  });

  router.get('/session', async (req, res, next) => {
    try {
      if (!authConfig) {
        res.status(503).json({ error: 'Authentication is not configured' });
        return;
      }

      const result = await authenticateSession({
        cookieHeader: req.headers.cookie,
        authConfig,
        db,
        verifier,
      });

      if (result.status === 'unauthenticated') {
        res.status(401).json({ user: null });
        return;
      }

      if (result.status === 'not_configured') {
        res.status(503).json({ error: 'Authentication is not configured' });
        return;
      }

      if (result.status === 'unverified') {
        res.status(403).json({ error: 'Verified email required' });
        return;
      }

      const body = sessionResponseFor(result);

      res.json(body);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function sessionResponseFor(
  result: Extract<AuthenticationResult, { status: 'authenticated' }>,
): AuthSessionResponse {
  return {
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
}

function getReturnToUrl(
  req: Request,
  configuredSelfUrl: string | null | undefined,
) {
  const selfUrl = configuredSelfUrl ?? `${req.protocol}://${req.get('host')}`;
  const requestedReturnTo = req.query.return_to;

  if (
    typeof requestedReturnTo === 'string' &&
    requestedReturnTo.startsWith('/') &&
    !requestedReturnTo.startsWith('//') &&
    !requestedReturnTo.startsWith('/api/')
  ) {
    return new URL(requestedReturnTo, selfUrl).toString();
  }

  return new URL('/', selfUrl).toString();
}
