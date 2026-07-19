import type { RequestHandler } from 'express';

import type { AuthConfig } from '../config.js';
import { recordActivity, type ActivityQueryable } from '../activity/store.js';
import { getPool } from '../db/pool.js';
import {
  upsertUserAccount,
  type UserAccount,
  type UserAccountQueryable,
} from '../users/model.js';
import { verifySessionCookie, type MctaiJwtVerifier } from './session.js';

export interface AuthMiddlewareOptions {
  authConfig: AuthConfig | null;
  db?: UserAccountQueryable & ActivityQueryable;
  verifier?: MctaiJwtVerifier;
  requireEmailVerified?: boolean;
}

export interface AuthenticatedLocals {
  currentUser: UserAccount;
  isNewUser: boolean;
}

export type AuthenticationResult =
  | {
      status: 'authenticated';
      user: UserAccount;
      isNew: boolean;
    }
  | {
      status: 'unauthenticated';
    }
  | {
      status: 'unverified';
      user: UserAccount;
      isNew: boolean;
    }
  | {
      status: 'not_configured';
    };

export async function authenticateSession({
  cookieHeader,
  authConfig,
  db = getPool(),
  verifier,
  requireEmailVerified = true,
}: AuthMiddlewareOptions & {
  cookieHeader: string | undefined;
}): Promise<AuthenticationResult> {
  if (!authConfig) {
    return { status: 'not_configured' };
  }

  const userInput = await verifySessionCookie(
    cookieHeader,
    authConfig,
    verifier,
  );

  if (!userInput) {
    return { status: 'unauthenticated' };
  }

  const result = await upsertUserAccount(db, userInput);

  if (requireEmailVerified && !result.user.emailVerified) {
    return {
      status: 'unverified',
      user: result.user,
      isNew: result.isNew,
    };
  }

  if (result.isNew) {
    await recordActivity(db, {
      actorSub: result.user.sub,
      action: 'user_joined',
      metadata: {
        email: result.user.email,
        name: result.user.name,
      },
    });
  }

  return {
    status: 'authenticated',
    user: result.user,
    isNew: result.isNew,
  };
}

export function requireAuth({
  authConfig,
  db,
  verifier,
  requireEmailVerified = true,
}: AuthMiddlewareOptions): RequestHandler {
  return async (req, res, next) => {
    try {
      const result = await authenticateSession({
        cookieHeader: req.headers.cookie,
        authConfig,
        db,
        verifier,
        requireEmailVerified,
      });

      if (result.status === 'not_configured') {
        res.status(503).json({ error: 'Authentication is not configured' });
        return;
      }

      if (result.status === 'unauthenticated') {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      if (result.status === 'unverified') {
        res.status(403).json({ error: 'Verified email required' });
        return;
      }

      res.locals.currentUser = result.user;
      res.locals.isNewUser = result.isNew;
      next();
    } catch (error) {
      next(error);
    }
  };
}
