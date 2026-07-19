import type { AuthConfig } from '../config.js';
import { buildAuthLoginUrl } from './urls.js';
import type {
  PasswordResetCompleteResponse,
  PasswordResetRequestResponse,
} from '../../shared/auth.js';

export function passwordResetRequestResponse(): PasswordResetRequestResponse {
  return {
    status: 'accepted',
    message:
      'If this email can be used to sign in, continue with the central sign-in flow.',
  };
}

export function passwordResetCompleteResponse(
  authConfig: AuthConfig,
  returnTo: string,
): PasswordResetCompleteResponse {
  return {
    status: 'central_auth_required',
    message:
      'Password recovery is managed by the central authentication service.',
    loginUrl: buildAuthLoginUrl(authConfig, returnTo),
  };
}
