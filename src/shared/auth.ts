export interface CurrentUser {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  pictureUrl: string | null;
}

export interface AuthSessionResponse {
  user: CurrentUser;
  isNew: boolean;
  message: string;
}

export interface PasswordResetRequestResponse {
  status: 'accepted';
  message: string;
}

export interface PasswordResetCompleteResponse {
  status: 'central_auth_required';
  message: string;
  loginUrl: string;
}
