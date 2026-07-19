import type { AuthConfig } from '../config.js';

export function buildAuthLoginUrl(
  authConfig: AuthConfig,
  returnTo: string,
): string {
  const url = new URL('/login', authConfig.url);
  url.searchParams.set('app_token', authConfig.appToken);
  url.searchParams.set('return_to', returnTo);

  return url.toString();
}
