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
