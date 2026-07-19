import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type {
  AuthSessionResponse,
  CurrentUser,
  PasswordResetCompleteResponse,
  PasswordResetRequestResponse,
} from '../../shared/auth';
import { apiFetch } from './api';
import { AuthProvider, useAuth, type AuthState } from './auth';

import './styles.css';

type VerificationStatus = 'success' | 'expired' | 'unknown';
type WorkspaceRole = 'owner' | 'member' | 'guest';
type ActivityAction =
  | 'user_joined'
  | 'invitation_sent'
  | 'invitation_accepted'
  | 'project_created'
  | 'document_uploaded'
  | 'document_shared';

interface WorkspaceDetailsResponse {
  workspace: {
    id: string;
    name: string;
    createdBySub: string;
    createdAt: string;
    updatedAt: string;
  };
  members: Array<{
    workspaceId: string;
    userSub: string;
    role: WorkspaceRole;
    createdAt: string;
    updatedAt: string;
  }>;
}

interface WorkspaceInvitationResponse {
  id: string;
  workspaceId: string;
  email: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  invitedBySub: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

interface PendingInvitationsResponse {
  invitations: WorkspaceInvitationResponse[];
}

interface InvitationAcceptResponse {
  invitation: WorkspaceInvitationResponse;
  membership: {
    workspaceId: string;
    userSub: string;
    role: WorkspaceRole;
    createdAt: string;
    updatedAt: string;
  };
}

interface ProjectResponse {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProjectListResponse {
  projects: ProjectResponse[];
}

interface ProjectDetailsResponse {
  project: ProjectResponse;
}

interface ProjectDocumentResponse {
  id: string;
  workspaceId: string;
  projectId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploaderSub: string;
  uploadedAt: string;
}

interface ProjectDocumentListResponse {
  documents: ProjectDocumentResponse[];
}

interface ProjectDocumentShareResponse {
  documentId: string;
  workspaceId: string;
  projectId: string;
  userSub: string;
  sharedBySub: string;
  createdAt: string;
}

interface ProjectDocumentShareListResponse {
  shares: ProjectDocumentShareResponse[];
}

interface ProjectDocumentShareMutationResponse {
  share: ProjectDocumentShareResponse;
  email: unknown;
}

interface ActivityEntryResponse {
  id: string;
  actorSub: string;
  action: ActivityAction;
  workspaceId: string | null;
  projectId: string | null;
  documentId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface ActivityHistoryResponse {
  activities: ActivityEntryResponse[];
  paging: {
    limit: number;
    offset: number;
    nextOffset: number | null;
  };
}

interface ProjectFormValues {
  name: string;
  description: string;
}

interface ProjectFormErrors {
  name?: string;
  description?: string;
}

const activeWorkspaceStorageKey = 'active-workspace-id';
const projectNameMaxLength = 120;
const projectDescriptionMaxLength = 1000;
const maxDocumentUploadBytes = 10 * 1024 * 1024;
const acceptedDocumentContentTypes = new Set([
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function App() {
  const path = window.location.pathname;

  if (path === '/login') {
    return <LoginScreen />;
  }

  if (path === '/signup') {
    return <SignUpScreen />;
  }

  if (path === '/forgot-password') {
    return <ForgotPasswordScreen />;
  }

  if (path === '/reset-password') {
    return <ResetPasswordScreen />;
  }

  if (path === '/dashboard') {
    return (
      <ProtectedRoute>
        <DashboardScreen />
      </ProtectedRoute>
    );
  }

  if (path === '/projects') {
    return (
      <ProtectedRoute>
        <ProjectsListScreen />
      </ProtectedRoute>
    );
  }

  if (path === '/activity') {
    return (
      <ProtectedRoute>
        <ActivityHistoryScreen />
      </ProtectedRoute>
    );
  }

  const documentViewerMatch = path.match(
    /^\/projects\/([^/]+)\/documents\/([^/]+)$/,
  );

  if (documentViewerMatch) {
    return (
      <ProtectedRoute>
        <ProjectDocumentViewerScreen
          projectId={decodeURIComponent(documentViewerMatch[1] ?? '')}
          documentId={decodeURIComponent(documentViewerMatch[2] ?? '')}
        />
      </ProtectedRoute>
    );
  }

  if (path.startsWith('/projects/')) {
    return (
      <ProtectedRoute>
        <ProjectDetailScreen projectId={decodeURIComponent(path.slice(10))} />
      </ProtectedRoute>
    );
  }

  if (path === '/signup/check-email') {
    return <CheckEmailScreen />;
  }

  if (path === '/verify') {
    return <VerificationResultScreen />;
  }

  if (path === '/invitations/accept') {
    return <InvitationAcceptScreen />;
  }

  return <HomeScreen />;
}

function HomeScreen() {
  const { state: session } = useAuth();

  if (session.status === 'loading') {
    return (
      <main className="app-shell centered-shell">
        <StatusPanel title="Checking your session" tone="neutral">
          <p>One moment while the secure session is confirmed.</p>
        </StatusPanel>
      </main>
    );
  }

  if (session.status === 'signed-in') {
    return <DashboardScreen />;
  }

  return (
    <main className="app-shell">
      <section className="hero-grid" aria-labelledby="home-title">
        <div className="hero-copy">
          <p className="eyebrow">Secure document workspace</p>
          <h1 id="home-title">Keep project documents organized and private.</h1>
          <p className="summary">
            Create a secure account to manage workspaces, share documents with
            the right people, and keep important project activity in one place.
          </p>
          <div className="button-row">
            <a className="button primary-button" href="/login">
              Sign in
            </a>
            <a className="button secondary-button" href="/signup">
              Create account
            </a>
          </div>
          {session.status === 'unavailable' ? (
            <p className="inline-alert">{session.message}</p>
          ) : null}
        </div>
        <DocumentPreview />
      </section>
    </main>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();

  if (state.status === 'loading') {
    return (
      <main className="app-shell centered-shell">
        <StatusPanel title="Checking your session" tone="neutral">
          <p>One moment while the secure session is confirmed.</p>
        </StatusPanel>
      </main>
    );
  }

  if (state.status === 'signed-out') {
    window.location.replace('/login');
    return (
      <main className="app-shell centered-shell">
        <StatusPanel title="Redirecting to sign in" tone="neutral">
          <p>Protected pages require an active secure session.</p>
        </StatusPanel>
      </main>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <main className="app-shell centered-shell">
        <StatusPanel title="Session unavailable" tone="warning">
          <p>{state.message}</p>
          <a className="button primary-button" href="/login">
            Sign in again
          </a>
        </StatusPanel>
      </main>
    );
  }

  return <>{children}</>;
}

function LoginScreen() {
  const errorMessage = useMemo(() => {
    const error = new URLSearchParams(window.location.search).get('error');

    if (error === 'credentials') {
      return 'The secure sign-in service could not confirm those credentials.';
    }

    if (error === 'unverified') {
      return 'Verify your email address before continuing.';
    }

    if (error === 'expired') {
      return 'Your sign-in link expired. Start sign-in again.';
    }

    return null;
  }, []);

  return (
    <main className="app-shell centered-shell">
      <section className="form-panel" aria-labelledby="login-title">
        <p className="eyebrow">Sign in</p>
        <h1 id="login-title">Continue securely.</h1>
        <p className="summary compact-summary">
          Sign in through the secure authentication service to open your
          document workspace.
        </p>
        {errorMessage ? <p className="inline-alert">{errorMessage}</p> : null}
        <div className="form-actions">
          <a
            className="button primary-button full-button"
            href="/api/auth/login"
          >
            Continue sign-in
          </a>
          <a className="button secondary-button full-button" href="/signup">
            Create account
          </a>
        </div>
        <p className="supporting-link">
          Need account recovery? <a href="/forgot-password">Forgot password</a>
        </p>
      </section>
    </main>
  );
}

function DashboardScreen() {
  const { state, signOut } = useAuth();
  const session = signedInSession(state);
  const [workspace, setWorkspace] = useState<WorkspaceDetailsResponse | null>(
    null,
  );
  const [pendingInvitations, setPendingInvitations] = useState<
    WorkspaceInvitationResponse[]
  >([]);
  const [workspaceName, setWorkspaceName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] =
    useState<WorkspaceInvitationResponse['role']>('member');
  const [status, setStatus] = useState<
    | { type: 'idle'; message: string | null }
    | { type: 'loading'; message: string }
    | { type: 'error'; message: string }
  >({ type: 'idle', message: null });

  const currentUserSub = session?.user.sub;
  const currentMembership =
    workspace?.members.find((member) => member.userSub === currentUserSub) ??
    null;
  const isOwner = currentMembership?.role === 'owner';

  async function loadWorkspace(workspaceId: string) {
    if (!currentUserSub) {
      return;
    }

    setStatus({ type: 'loading', message: 'Loading workspace.' });

    try {
      const details = await fetchWorkspaceDetails(workspaceId);
      const role =
        details.members.find((member) => member.userSub === currentUserSub)
          ?.role ?? null;
      const invitations =
        role === 'owner' ? await fetchPendingInvitations(workspaceId) : [];

      setWorkspace(details);
      setPendingInvitations(invitations);
      window.localStorage.setItem(
        activeWorkspaceStorageKey,
        details.workspace.id,
      );
      setStatus({ type: 'idle', message: 'Workspace loaded.' });
    } catch (error) {
      window.localStorage.removeItem(activeWorkspaceStorageKey);
      setWorkspace(null);
      setPendingInvitations([]);
      setStatus({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Unable to load workspace.',
      });
    }
  }

  useEffect(() => {
    if (!currentUserSub) {
      return;
    }

    const workspaceId = window.localStorage.getItem(activeWorkspaceStorageKey);

    if (workspaceId && !workspace && status.type === 'idle') {
      void loadWorkspace(workspaceId);
    }
  }, [currentUserSub]);

  async function submitWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = workspaceName.trim();

    if (name.length === 0) {
      setStatus({ type: 'error', message: 'Workspace name is required.' });
      return;
    }

    setStatus({ type: 'loading', message: 'Creating workspace.' });

    try {
      const details = await createWorkspaceRequest(name);
      setWorkspace(details);
      setPendingInvitations([]);
      setWorkspaceName('');
      window.localStorage.setItem(
        activeWorkspaceStorageKey,
        details.workspace.id,
      );
      setStatus({ type: 'idle', message: 'Workspace created.' });
    } catch (error) {
      setStatus({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to create workspace.',
      });
    }
  }

  async function submitInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!workspace || !isOwner) {
      return;
    }

    const email = inviteEmail.trim();
    if (!isValidEmail(email)) {
      setStatus({ type: 'error', message: 'Enter a valid invite email.' });
      return;
    }

    setStatus({ type: 'loading', message: 'Sending invitation.' });

    try {
      await createWorkspaceInvitation(
        workspace.workspace.id,
        email,
        inviteRole,
      );
      setPendingInvitations(
        await fetchPendingInvitations(workspace.workspace.id),
      );
      setInviteEmail('');
      setInviteRole('member');
      setStatus({ type: 'idle', message: 'Invitation sent.' });
    } catch (error) {
      setStatus({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Unable to send invitation.',
      });
    }
  }

  async function revokeInvitation(invitationId: string) {
    if (!workspace || !isOwner) {
      return;
    }

    setStatus({ type: 'loading', message: 'Revoking invitation.' });

    try {
      await revokeWorkspaceInvitation(workspace.workspace.id, invitationId);
      setPendingInvitations((invitations) =>
        invitations.filter((invitation) => invitation.id !== invitationId),
      );
      setStatus({ type: 'idle', message: 'Invitation revoked.' });
    } catch (error) {
      setStatus({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to revoke invitation.',
      });
    }
  }

  const workspaceCount = workspace ? 1 : 0;
  const memberCount = workspace?.members.length ?? 0;
  const pendingCount = isOwner ? pendingInvitations.length : 0;

  if (!session) {
    return null;
  }

  return (
    <main className="app-shell signed-in-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Signed in</p>
          <h1>{workspace ? workspace.workspace.name : 'Workspace setup'}</h1>
        </div>
        <div className="topbar-actions">
          <UserBadge user={session.user} />
          <button
            className="button secondary-button"
            type="button"
            onClick={() => {
              void signOut();
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="dashboard-grid" aria-label="Workspace overview">
        <article className="metric-panel">
          <span className="metric-value">{workspaceCount}</span>
          <h2>Workspaces</h2>
          <p>
            {workspace
              ? 'Your active workspace is ready.'
              : 'Create a workspace to organize teams, projects, and documents.'}
          </p>
        </article>
        <article className="metric-panel">
          <span className="metric-value">{memberCount}</span>
          <h2>Members</h2>
          <p>
            {workspace
              ? 'Current workspace access is shown below.'
              : 'Members appear after workspace setup.'}
          </p>
        </article>
        <article className="metric-panel">
          <span className="metric-value">{pendingCount}</span>
          <h2>Pending invites</h2>
          <p>
            {isOwner
              ? 'Invitations waiting for a response.'
              : 'Only owners manage invitations.'}
          </p>
        </article>
      </section>

      {status.type !== 'idle' || status.message ? (
        <p
          className={
            status.type === 'error' ? 'inline-alert dashboard-alert' : 'notice'
          }
        >
          {status.message}
        </p>
      ) : null}

      {!workspace ? (
        <section className="workspace-panel" aria-labelledby="setup-title">
          <div>
            <p className="eyebrow">Workspace setup</p>
            <h2 id="setup-title">Create the first workspace.</h2>
            <p>
              Workspaces group members, projects, and shared documents under one
              access boundary.
            </p>
          </div>
          <form className="inline-form" onSubmit={submitWorkspace}>
            <label htmlFor="workspace-name">Workspace name</label>
            <div className="form-row">
              <input
                id="workspace-name"
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                placeholder="Client files"
              />
              <button
                className="button primary-button"
                type="submit"
                disabled={status.type === 'loading'}
              >
                Create
              </button>
            </div>
          </form>
        </section>
      ) : (
        <>
          <section className="workspace-panel" aria-labelledby="members-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Members</p>
                <h2 id="members-title">Workspace access</h2>
              </div>
              {currentMembership ? (
                <span className="role-pill">{currentMembership.role}</span>
              ) : null}
            </div>
            <div className="member-list">
              {workspace.members.map((member) => (
                <div className="member-row" key={member.userSub}>
                  <div>
                    <strong>{member.userSub}</strong>
                    <span>Added {formatDate(member.createdAt)}</span>
                  </div>
                  <span className="role-pill">{member.role}</span>
                </div>
              ))}
            </div>
            <div className="button-row compact-row">
              <a className="button secondary-button" href="/projects">
                View projects
              </a>
              <a className="button secondary-button" href="/activity">
                Activity
              </a>
            </div>
          </section>

          {isOwner ? (
            <section className="workspace-panel" aria-labelledby="invite-title">
              <div>
                <p className="eyebrow">Invitations</p>
                <h2 id="invite-title">Invite by email</h2>
              </div>
              <form className="invite-form" onSubmit={submitInvitation}>
                <label htmlFor="invite-email">Email address</label>
                <input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="teammate@example.com"
                />
                <label htmlFor="invite-role">Role</label>
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(event) =>
                    setInviteRole(
                      event.target.value as WorkspaceInvitationResponse['role'],
                    )
                  }
                >
                  <option value="member">Member</option>
                  <option value="guest">Guest</option>
                </select>
                <button
                  className="button primary-button"
                  type="submit"
                  disabled={status.type === 'loading'}
                >
                  Send invite
                </button>
              </form>

              <div className="pending-list" aria-label="Pending invitations">
                {pendingInvitations.length === 0 ? (
                  <p>No pending invitations.</p>
                ) : (
                  pendingInvitations.map((invitation) => (
                    <div className="member-row" key={invitation.id}>
                      <div>
                        <strong>{invitation.email}</strong>
                        <span>
                          {invitation.role} · expires{' '}
                          {formatDate(invitation.expiresAt)}
                        </span>
                      </div>
                      <button
                        className="button secondary-button compact-button"
                        type="button"
                        onClick={() => {
                          void revokeInvitation(invitation.id);
                        }}
                        disabled={status.type === 'loading'}
                      >
                        Revoke
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}

function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submitSignUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();

    if (!isValidEmail(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }

    setError(null);
    window.location.assign('/api/auth/login');
  }

  return (
    <main className="app-shell centered-shell">
      <section className="form-panel" aria-labelledby="signup-title">
        <p className="eyebrow">Create account</p>
        <h1 id="signup-title">Start with secure sign-up.</h1>
        <p className="summary compact-summary">
          Accounts are created through the secure sign-in service. Enter your
          email to continue.
        </p>
        <form onSubmit={submitSignUp} noValidate>
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            aria-invalid={error ? 'true' : 'false'}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
          {error ? <p className="field-error">{error}</p> : null}
          <button className="button primary-button full-button" type="submit">
            Continue securely
          </button>
        </form>
        <p className="supporting-link">
          Already have access? <a href="/login">Sign in</a>
        </p>
      </section>
    </main>
  );
}

function CheckEmailScreen() {
  return (
    <main className="app-shell centered-shell">
      <StatusPanel title="Check your email" tone="neutral">
        <p>
          If the secure sign-in service needs to verify your address, it will
          send a message with the next step.
        </p>
        <div className="button-row">
          <a className="button primary-button" href="/login">
            Continue sign-in
          </a>
          <a className="button secondary-button" href="/">
            Back home
          </a>
        </div>
      </StatusPanel>
    </main>
  );
}

function VerificationResultScreen() {
  const status = useMemo<VerificationStatus>(() => {
    const rawStatus = new URLSearchParams(window.location.search).get('status');
    return rawStatus === 'success' || rawStatus === 'expired'
      ? rawStatus
      : 'unknown';
  }, []);

  if (status === 'success') {
    return (
      <main className="app-shell centered-shell">
        <StatusPanel title="Email verified" tone="success">
          <p>Your email address is verified. Continue to your workspace.</p>
          <a className="button primary-button" href="/login">
            Continue
          </a>
        </StatusPanel>
      </main>
    );
  }

  if (status === 'expired') {
    return (
      <main className="app-shell centered-shell">
        <StatusPanel title="Verification link expired" tone="warning">
          <p>
            This link is no longer active. Start sign-in again to receive a
            fresh verification step when one is needed.
          </p>
          <a className="button primary-button" href="/signup">
            Start again
          </a>
        </StatusPanel>
      </main>
    );
  }

  return (
    <main className="app-shell centered-shell">
      <StatusPanel title="Verification status unavailable" tone="neutral">
        <p>
          The secure sign-in service could not confirm a verification result
          from this link.
        </p>
        <a className="button primary-button" href="/api/auth/login">
          Continue sign-in
        </a>
      </StatusPanel>
    </main>
  );
}

function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<
    | { type: 'idle'; error: string | null }
    | { type: 'submitting'; error: null }
    | { type: 'sent'; message: string }
  >({ type: 'idle', error: null });

  async function submitRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();

    if (!isValidEmail(normalizedEmail)) {
      setStatus({ type: 'idle', error: 'Enter a valid email address.' });
      return;
    }

    setStatus({ type: 'submitting', error: null });

    try {
      const response = await apiFetch('/api/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email: normalizedEmail }),
      });

      if (!response.ok) {
        throw new Error(`Recovery request failed with ${response.status}`);
      }

      const body = (await response.json()) as PasswordResetRequestResponse;
      setStatus({ type: 'sent', message: body.message });
    } catch (error) {
      setStatus({
        type: 'idle',
        error:
          error instanceof Error
            ? error.message
            : 'Unable to start account recovery.',
      });
    }
  }

  if (status.type === 'sent') {
    return (
      <main className="app-shell centered-shell">
        <StatusPanel title="Check your sign-in options" tone="neutral">
          <p>{status.message}</p>
          <div className="button-row">
            <a className="button primary-button" href="/login">
              Continue sign-in
            </a>
            <a className="button secondary-button" href="/">
              Back home
            </a>
          </div>
        </StatusPanel>
      </main>
    );
  }

  return (
    <main className="app-shell centered-shell">
      <section className="form-panel" aria-labelledby="forgot-title">
        <p className="eyebrow">Account recovery</p>
        <h1 id="forgot-title">Recover access.</h1>
        <p className="summary compact-summary">
          Enter your email and continue through the secure sign-in service. The
          response is the same whether an email is registered or not.
        </p>
        <form onSubmit={submitRequest} noValidate>
          <label htmlFor="recovery-email">Email address</label>
          <input
            id="recovery-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            aria-invalid={
              status.type === 'idle' && status.error ? 'true' : 'false'
            }
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
          {status.type === 'idle' && status.error ? (
            <p className="field-error">{status.error}</p>
          ) : null}
          <button
            className="button primary-button full-button"
            type="submit"
            disabled={status.type === 'submitting'}
          >
            {status.type === 'submitting' ? 'Sending...' : 'Continue recovery'}
          </button>
        </form>
        <p className="supporting-link">
          Remembered access? <a href="/login">Sign in</a>
        </p>
      </section>
    </main>
  );
}

function ResetPasswordScreen() {
  const [status, setStatus] = useState<
    | { type: 'ready' }
    | { type: 'submitting' }
    | { type: 'error'; message: string }
  >({ type: 'ready' });
  const expired = useMemo(
    () =>
      new URLSearchParams(window.location.search).get('status') === 'expired',
    [],
  );

  async function continueRecovery() {
    setStatus({ type: 'submitting' });

    try {
      const response = await apiFetch('/api/auth/password-reset/complete', {
        method: 'POST',
        body: JSON.stringify({
          token: new URLSearchParams(window.location.search).get('token'),
        }),
      });
      const body = (await response.json()) as PasswordResetCompleteResponse;

      if (body.loginUrl) {
        window.location.assign(body.loginUrl);
        return;
      }

      throw new Error(`Recovery link failed with ${response.status}`);
    } catch (error) {
      setStatus({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to continue account recovery.',
      });
    }
  }

  if (expired) {
    return (
      <main className="app-shell centered-shell">
        <StatusPanel title="Reset link expired" tone="warning">
          <p>
            This recovery link is no longer active. Start recovery again to
            continue through the secure sign-in service.
          </p>
          <a className="button primary-button" href="/forgot-password">
            Request a new link
          </a>
        </StatusPanel>
      </main>
    );
  }

  return (
    <main className="app-shell centered-shell">
      <StatusPanel title="Continue account recovery" tone="neutral">
        <p>
          Password recovery is completed by the secure authentication service.
          Continue there to finish safely.
        </p>
        {status.type === 'error' ? (
          <p className="inline-alert">{status.message}</p>
        ) : null}
        <button
          className="button primary-button"
          type="button"
          onClick={continueRecovery}
          disabled={status.type === 'submitting'}
        >
          {status.type === 'submitting' ? 'Opening...' : 'Continue recovery'}
        </button>
      </StatusPanel>
    </main>
  );
}

function ProjectsListScreen() {
  const { state } = useAuth();
  const session = signedInSession(state);
  const [workspace, setWorkspace] = useState<WorkspaceDetailsResponse | null>(
    null,
  );
  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [formErrors, setFormErrors] = useState<ProjectFormErrors>({});
  const [status, setStatus] = useState<
    | { type: 'idle'; message: string | null }
    | { type: 'loading'; message: string }
    | { type: 'success'; message: string }
    | { type: 'error'; message: string }
  >({ type: 'idle', message: null });
  const currentRole = workspace?.members.find(
    (member) => member.userSub === session?.user.sub,
  )?.role;
  const canManage = currentRole ? canManageProjects(currentRole) : false;

  useEffect(() => {
    const workspaceId = window.localStorage.getItem(activeWorkspaceStorageKey);

    if (!workspaceId || workspace || status.type !== 'idle') {
      return;
    }

    async function loadProjects() {
      setStatus({ type: 'loading', message: 'Loading projects.' });

      try {
        const [workspaceDetails, projectList] = await Promise.all([
          fetchWorkspaceDetails(workspaceId),
          fetchProjects(workspaceId),
        ]);

        setWorkspace(workspaceDetails);
        setProjects(projectList);
        setStatus({ type: 'idle', message: null });
      } catch (error) {
        setStatus({
          type: 'error',
          message:
            error instanceof Error ? error.message : 'Unable to load projects.',
        });
      }
    }

    void loadProjects();
  }, [workspace, status.type]);

  async function submitProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!workspace || !canManage) {
      return;
    }

    const validatedForm = validateProjectForm({
      name: projectName,
      description: projectDescription,
    });

    if (!validatedForm.ok) {
      setFormErrors(validatedForm.errors);
      setStatus({
        type: 'error',
        message: 'Review the highlighted fields before creating the project.',
      });
      return;
    }

    setFormErrors({});
    setStatus({ type: 'loading', message: 'Creating project.' });

    try {
      const project = await createProjectRequest(
        workspace.workspace.id,
        validatedForm.values.name,
        validatedForm.values.description,
      );

      setProjects((currentProjects) => [project, ...currentProjects]);
      setProjectName('');
      setProjectDescription('');
      setFormErrors({});
      setStatus({ type: 'success', message: 'Project created.' });
    } catch (error) {
      setStatus({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Unable to create project.',
      });
    }
  }

  if (!session) {
    return null;
  }

  if (!window.localStorage.getItem(activeWorkspaceStorageKey)) {
    return (
      <main className="app-shell centered-shell">
        <StatusPanel title="Workspace required" tone="neutral">
          <p>Create or open a workspace before viewing projects.</p>
          <a className="button primary-button" href="/dashboard">
            Open dashboard
          </a>
        </StatusPanel>
      </main>
    );
  }

  return (
    <main className="app-shell signed-in-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Projects</p>
          <h1>{workspace?.workspace.name ?? 'Workspace projects'}</h1>
        </div>
        <div className="topbar-actions">
          <UserBadge user={session.user} />
          <a className="button secondary-button" href="/dashboard">
            Dashboard
          </a>
        </div>
      </header>

      {status.type !== 'idle' || status.message ? (
        <p
          className={
            status.type === 'error'
              ? 'inline-alert dashboard-alert'
              : status.type === 'success'
                ? 'notice success-notice'
                : 'notice'
          }
        >
          {status.message}
        </p>
      ) : null}

      {workspace && canManage ? (
        <section className="workspace-panel" aria-labelledby="create-project">
          <div>
            <p className="eyebrow">Create project</p>
            <h2 id="create-project">Add a workspace project.</h2>
          </div>
          <form className="project-form" onSubmit={submitProject}>
            <label htmlFor="project-name">Project name</label>
            <input
              id="project-name"
              value={projectName}
              maxLength={projectNameMaxLength}
              aria-invalid={formErrors.name ? 'true' : undefined}
              aria-describedby={
                formErrors.name ? 'project-name-error' : undefined
              }
              onChange={(event) => {
                setProjectName(event.target.value);
                setFormErrors((currentErrors) => ({
                  ...currentErrors,
                  name: undefined,
                }));
              }}
              placeholder="Launch plan"
            />
            {formErrors.name ? (
              <p className="field-error" id="project-name-error">
                {formErrors.name}
              </p>
            ) : null}
            <label htmlFor="project-description">Description</label>
            <textarea
              id="project-description"
              value={projectDescription}
              maxLength={projectDescriptionMaxLength}
              aria-invalid={formErrors.description ? 'true' : undefined}
              aria-describedby={
                formErrors.description
                  ? 'project-description-error'
                  : 'project-description-hint'
              }
              onChange={(event) => {
                setProjectDescription(event.target.value);
                setFormErrors((currentErrors) => ({
                  ...currentErrors,
                  description: undefined,
                }));
              }}
              placeholder="Notes, files, and milestones"
            />
            {formErrors.description ? (
              <p className="field-error" id="project-description-error">
                {formErrors.description}
              </p>
            ) : (
              <p className="field-hint" id="project-description-hint">
                Optional. Up to {projectDescriptionMaxLength} characters.
              </p>
            )}
            <button
              className="button primary-button"
              type="submit"
              disabled={status.type === 'loading'}
            >
              Create project
            </button>
          </form>
        </section>
      ) : null}

      <section className="workspace-panel" aria-labelledby="project-list">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Project list</p>
            <h2 id="project-list">Workspace projects</h2>
          </div>
          {currentRole ? (
            <span className="role-pill">{currentRole}</span>
          ) : null}
        </div>
        {projects.length === 0 ? (
          <p>No projects are visible in this workspace.</p>
        ) : (
          <div className="project-grid">
            {projects.map((project) => (
              <a
                className="project-card"
                href={`/projects/${encodeURIComponent(project.id)}`}
                key={project.id}
              >
                <strong>{project.name}</strong>
                <span>{project.description ?? 'No description'}</span>
                <small>Updated {formatDate(project.updatedAt)}</small>
              </a>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function ActivityHistoryScreen() {
  const { state } = useAuth();
  const session = signedInSession(state);
  const [workspace, setWorkspace] = useState<WorkspaceDetailsResponse | null>(
    null,
  );
  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [activities, setActivities] = useState<ActivityEntryResponse[]>([]);
  const [projectFilter, setProjectFilter] = useState('');
  const [paging, setPaging] = useState({
    limit: 10,
    offset: 0,
    nextOffset: null as number | null,
  });
  const [status, setStatus] = useState<
    | { type: 'idle'; message: string | null }
    | { type: 'loading'; message: string }
    | { type: 'error'; message: string }
  >({ type: 'idle', message: null });

  useEffect(() => {
    const workspaceId = window.localStorage.getItem(activeWorkspaceStorageKey);

    if (!workspaceId || workspace || status.type !== 'idle') {
      return;
    }

    void loadActivityPage({ workspaceId, offset: 0, projectId: projectFilter });
  }, [workspace, status.type]);

  async function loadActivityPage(input: {
    workspaceId?: string;
    offset: number;
    projectId: string;
  }) {
    const workspaceId =
      input.workspaceId ??
      window.localStorage.getItem(activeWorkspaceStorageKey);

    if (!workspaceId) {
      return;
    }

    setStatus({ type: 'loading', message: 'Loading activity.' });

    try {
      const [workspaceDetails, projectList, activityHistory] =
        await Promise.all([
          workspace
            ? Promise.resolve(workspace)
            : fetchWorkspaceDetails(workspaceId),
          projects.length > 0
            ? Promise.resolve(projects)
            : fetchProjects(workspaceId),
          fetchWorkspaceActivity(workspaceId, {
            limit: paging.limit,
            offset: input.offset,
            projectId: input.projectId || null,
          }),
        ]);

      setWorkspace(workspaceDetails);
      setProjects(projectList);
      setActivities(activityHistory.activities);
      setPaging(activityHistory.paging);
      setStatus({ type: 'idle', message: null });
    } catch (error) {
      setStatus({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Unable to load activity.',
      });
    }
  }

  if (!session) {
    return null;
  }

  if (!window.localStorage.getItem(activeWorkspaceStorageKey)) {
    return (
      <main className="app-shell centered-shell">
        <StatusPanel title="Workspace required" tone="neutral">
          <p>Open a workspace before viewing activity.</p>
          <a className="button primary-button" href="/dashboard">
            Open dashboard
          </a>
        </StatusPanel>
      </main>
    );
  }

  const projectNames = new Map(
    projects.map((project) => [project.id, project.name] as const),
  );
  const previousOffset =
    paging.offset > 0 ? Math.max(0, paging.offset - paging.limit) : null;
  const pageRange =
    activities.length > 0
      ? `${paging.offset + 1}-${paging.offset + activities.length}`
      : '0';

  return (
    <main className="app-shell signed-in-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Activity</p>
          <h1>{workspace?.workspace.name ?? 'Workspace activity'}</h1>
        </div>
        <div className="topbar-actions">
          <UserBadge user={session.user} />
          <a className="button secondary-button" href="/dashboard">
            Dashboard
          </a>
          <a className="button secondary-button" href="/projects">
            Projects
          </a>
        </div>
      </header>

      {status.type !== 'idle' || status.message ? (
        <p
          className={
            status.type === 'error' ? 'inline-alert dashboard-alert' : 'notice'
          }
        >
          {status.message}
        </p>
      ) : null}

      <section className="workspace-panel" aria-labelledby="activity-filter">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Timeline</p>
            <h2 id="activity-filter">Workspace activity</h2>
          </div>
          <span className="role-pill">{activities.length}</span>
        </div>

        <form
          className="activity-filter-form"
          onSubmit={(event) => {
            event.preventDefault();
            void loadActivityPage({ offset: 0, projectId: projectFilter });
          }}
        >
          <label htmlFor="activity-project">Project</label>
          <select
            id="activity-project"
            value={projectFilter}
            onChange={(event) => {
              const nextProjectId = event.target.value;
              setProjectFilter(nextProjectId);
              void loadActivityPage({ offset: 0, projectId: nextProjectId });
            }}
            disabled={status.type === 'loading'}
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </form>

        {activities.length === 0 ? (
          <p>No activity is visible for this selection.</p>
        ) : (
          <ol className="activity-timeline">
            {activities.map((activity) => {
              const copy = activityTimelineCopy(activity, projectNames);

              return (
                <li className="activity-item" key={activity.id}>
                  <div className="activity-dot" aria-hidden="true" />
                  <div>
                    <div className="activity-item-heading">
                      <strong>{copy.title}</strong>
                      <time dateTime={activity.createdAt}>
                        {formatDateTime(activity.createdAt)}
                      </time>
                    </div>
                    <p>{copy.detail}</p>
                    <span>{activity.actorSub}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div className="activity-pager" aria-label="Activity pages">
          <button
            className="button secondary-button"
            type="button"
            disabled={previousOffset === null || status.type === 'loading'}
            onClick={() => {
              if (previousOffset !== null) {
                void loadActivityPage({
                  offset: previousOffset,
                  projectId: projectFilter,
                });
              }
            }}
          >
            Previous
          </button>
          <span>{pageRange}</span>
          <button
            className="button primary-button"
            type="button"
            disabled={paging.nextOffset === null || status.type === 'loading'}
            onClick={() => {
              if (paging.nextOffset !== null) {
                void loadActivityPage({
                  offset: paging.nextOffset,
                  projectId: projectFilter,
                });
              }
            }}
          >
            Next
          </button>
        </div>
      </section>
    </main>
  );
}

function ProjectDetailScreen({ projectId }: { projectId: string }) {
  const { state } = useAuth();
  const session = signedInSession(state);
  const [workspace, setWorkspace] = useState<WorkspaceDetailsResponse | null>(
    null,
  );
  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [documents, setDocuments] = useState<ProjectDocumentResponse[]>([]);
  const [documentSharesById, setDocumentSharesById] = useState<
    Record<string, ProjectDocumentShareResponse[]>
  >({});
  const [shareRecipientsByDocumentId, setShareRecipientsByDocumentId] =
    useState<Record<string, string>>({});
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [formErrors, setFormErrors] = useState<ProjectFormErrors>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [status, setStatus] = useState<
    | { type: 'idle'; message: string | null }
    | { type: 'loading'; message: string }
    | { type: 'success'; message: string }
    | { type: 'error'; message: string }
  >({ type: 'idle', message: null });
  const [uploadStatus, setUploadStatus] = useState<
    | { type: 'idle'; message: string | null }
    | { type: 'loading'; message: string }
    | { type: 'success'; message: string }
    | { type: 'error'; message: string }
  >({ type: 'idle', message: null });
  const [shareStatus, setShareStatus] = useState<
    | { type: 'idle'; documentId: string | null; message: string | null }
    | { type: 'loading'; documentId: string; message: string }
    | { type: 'success'; documentId: string; message: string }
    | { type: 'error'; documentId: string | null; message: string }
  >({ type: 'idle', documentId: null, message: null });
  const currentRole = workspace?.members.find(
    (member) => member.userSub === session?.user.sub,
  )?.role;
  const canManage = currentRole ? canManageProjects(currentRole) : false;

  useEffect(() => {
    const workspaceId = window.localStorage.getItem(activeWorkspaceStorageKey);

    if (!workspaceId || !session || project || status.type !== 'idle') {
      return;
    }

    async function loadProject() {
      setStatus({ type: 'loading', message: 'Loading project.' });

      try {
        const [workspaceDetails, projectDetails, projectDocuments] =
          await Promise.all([
            fetchWorkspaceDetails(workspaceId),
            fetchProjectDetails(workspaceId, projectId),
            fetchProjectDocuments(workspaceId, projectId),
          ]);
        const loadedRole = workspaceDetails.members.find(
          (member) => member.userSub === session.user.sub,
        )?.role;
        const shareEntries = canManageProjects(loadedRole)
          ? await Promise.all(
              projectDocuments.map(async (projectDocument) => [
                projectDocument.id,
                await fetchProjectDocumentShares(
                  workspaceId,
                  projectId,
                  projectDocument.id,
                ),
              ]),
            )
          : [];

        setWorkspace(workspaceDetails);
        setProject(projectDetails);
        setDocuments(projectDocuments);
        setDocumentSharesById(Object.fromEntries(shareEntries));
        setProjectName(projectDetails.name);
        setProjectDescription(projectDetails.description ?? '');
        setStatus({ type: 'idle', message: null });
      } catch (error) {
        setStatus({
          type: 'error',
          message:
            error instanceof Error ? error.message : 'Unable to load project.',
        });
      }
    }

    void loadProject();
  }, [project, projectId, session, status.type]);

  async function submitProjectUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!workspace || !project || !canManage) {
      return;
    }

    const validatedForm = validateProjectForm({
      name: projectName,
      description: projectDescription,
    });

    if (!validatedForm.ok) {
      setFormErrors(validatedForm.errors);
      setStatus({
        type: 'error',
        message: 'Review the highlighted fields before saving the project.',
      });
      return;
    }

    setFormErrors({});
    setStatus({ type: 'loading', message: 'Saving project.' });

    try {
      const updatedProject = await updateProjectRequest(
        workspace.workspace.id,
        project.id,
        validatedForm.values.name,
        validatedForm.values.description,
      );

      setProject(updatedProject);
      setProjectName(updatedProject.name);
      setProjectDescription(updatedProject.description ?? '');
      setFormErrors({});
      setStatus({ type: 'success', message: 'Project saved.' });
    } catch (error) {
      setStatus({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Unable to save project.',
      });
    }
  }

  async function submitDocumentUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!workspace || !project || !canManage) {
      return;
    }

    const file = selectedFile;
    const validationError = validateDocumentUploadFile(file);
    if (validationError) {
      setUploadStatus({ type: 'error', message: validationError });
      setUploadProgress(0);
      return;
    }

    setUploadProgress(0);
    setUploadStatus({ type: 'loading', message: 'Uploading document.' });

    try {
      const document = await uploadProjectDocumentRequest(
        workspace.workspace.id,
        project.id,
        file,
        setUploadProgress,
      );

      setDocuments((currentDocuments) => [document, ...currentDocuments]);
      setSelectedFile(null);
      setUploadProgress(100);
      setUploadStatus({ type: 'success', message: 'Document uploaded.' });
      event.currentTarget.reset();
    } catch (error) {
      setUploadStatus({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Unable to upload document.',
      });
    }
  }

  async function submitDocumentShare(
    event: React.FormEvent<HTMLFormElement>,
    document: ProjectDocumentResponse,
  ) {
    event.preventDefault();

    if (!workspace || !project || !canManage) {
      return;
    }

    const userSub = shareRecipientsByDocumentId[document.id];
    if (!userSub) {
      setShareStatus({
        type: 'error',
        documentId: document.id,
        message: 'Choose a workspace user to share with.',
      });
      return;
    }

    setShareStatus({
      type: 'loading',
      documentId: document.id,
      message: 'Sharing document.',
    });

    try {
      const result = await shareProjectDocumentRequest(
        workspace.workspace.id,
        project.id,
        document.id,
        userSub,
      );

      setDocumentSharesById((currentShares) => ({
        ...currentShares,
        [document.id]: upsertDocumentShare(
          currentShares[document.id] ?? [],
          result.share,
        ),
      }));
      setShareRecipientsByDocumentId((currentRecipients) => ({
        ...currentRecipients,
        [document.id]: '',
      }));
      setShareStatus({
        type: 'success',
        documentId: document.id,
        message:
          result.email && typeof result.email === 'object'
            ? 'Document shared and notification handled.'
            : 'Document share already exists.',
      });
    } catch (error) {
      setShareStatus({
        type: 'error',
        documentId: document.id,
        message:
          error instanceof Error ? error.message : 'Unable to share document.',
      });
    }
  }

  async function removeDocumentShare(
    document: ProjectDocumentResponse,
    userSub: string,
  ) {
    if (!workspace || !project || !canManage) {
      return;
    }

    setShareStatus({
      type: 'loading',
      documentId: document.id,
      message: 'Removing share.',
    });

    try {
      await unshareProjectDocumentRequest(
        workspace.workspace.id,
        project.id,
        document.id,
        userSub,
      );
      setDocumentSharesById((currentShares) => ({
        ...currentShares,
        [document.id]: (currentShares[document.id] ?? []).filter(
          (share) => share.userSub !== userSub,
        ),
      }));
      setShareStatus({
        type: 'success',
        documentId: document.id,
        message: 'Document share removed.',
      });
    } catch (error) {
      setShareStatus({
        type: 'error',
        documentId: document.id,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to remove document share.',
      });
    }
  }

  if (!session) {
    return null;
  }

  if (!window.localStorage.getItem(activeWorkspaceStorageKey)) {
    return (
      <main className="app-shell centered-shell">
        <StatusPanel title="Workspace required" tone="neutral">
          <p>Open a workspace before viewing project details.</p>
          <a className="button primary-button" href="/dashboard">
            Open dashboard
          </a>
        </StatusPanel>
      </main>
    );
  }

  return (
    <main className="app-shell signed-in-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Project detail</p>
          <h1>{project?.name ?? 'Project'}</h1>
        </div>
        <div className="topbar-actions">
          <UserBadge user={session.user} />
          <a className="button secondary-button" href="/projects">
            Projects
          </a>
        </div>
      </header>

      {status.type !== 'idle' || status.message ? (
        <p
          className={
            status.type === 'error'
              ? 'inline-alert dashboard-alert'
              : status.type === 'success'
                ? 'notice success-notice'
                : 'notice'
          }
        >
          {status.message}
        </p>
      ) : null}

      {project ? (
        <section className="workspace-panel" aria-labelledby="project-detail">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Details</p>
              <h2 id="project-detail">{project.name}</h2>
            </div>
            {currentRole ? (
              <span className="role-pill">{currentRole}</span>
            ) : null}
          </div>
          <p>{project.description ?? 'No description has been added.'}</p>
          <p>Updated {formatDate(project.updatedAt)}</p>
        </section>
      ) : null}

      {project && canManage ? (
        <section className="workspace-panel" aria-labelledby="upload-document">
          <div>
            <p className="eyebrow">Upload</p>
            <h2 id="upload-document">Add images and PDFs.</h2>
          </div>
          <form className="project-form" onSubmit={submitDocumentUpload}>
            <label htmlFor="project-document">Document file</label>
            <input
              id="project-document"
              type="file"
              accept="application/pdf,image/gif,image/jpeg,image/png,image/webp"
              aria-describedby="project-document-hint"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setSelectedFile(file);
                setUploadProgress(0);
                setUploadStatus({ type: 'idle', message: null });
              }}
            />
            <p className="field-hint" id="project-document-hint">
              PDF, PNG, JPEG, GIF, or WebP. Up to{' '}
              {formatBytes(maxDocumentUploadBytes)}.
            </p>
            {selectedFile ? (
              <p className="selected-file">
                {selectedFile.name} - {formatBytes(selectedFile.size)}
              </p>
            ) : null}
            {uploadStatus.type !== 'idle' || uploadStatus.message ? (
              <p
                className={
                  uploadStatus.type === 'error'
                    ? 'inline-alert dashboard-alert'
                    : uploadStatus.type === 'success'
                      ? 'notice success-notice'
                      : 'notice'
                }
              >
                {uploadStatus.message}
              </p>
            ) : null}
            {uploadStatus.type === 'loading' ? (
              <progress
                className="upload-progress"
                max="100"
                value={uploadProgress}
              >
                {uploadProgress}%
              </progress>
            ) : null}
            <button
              className="button primary-button"
              type="submit"
              disabled={uploadStatus.type === 'loading'}
            >
              Upload document
            </button>
          </form>
        </section>
      ) : null}

      {project ? (
        <section
          className="workspace-panel"
          aria-labelledby="project-documents"
        >
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Documents</p>
              <h2 id="project-documents">Project documents</h2>
            </div>
            <span className="role-pill">{documents.length}</span>
          </div>
          {documents.length === 0 ? (
            <p>
              {currentRole === 'guest'
                ? 'No documents have been shared with you in this project.'
                : 'No documents have been uploaded to this project.'}
            </p>
          ) : (
            <div className="document-grid">
              {documents.map((document) => (
                <article className="document-card" key={document.id}>
                  {(() => {
                    const documentShares =
                      documentSharesById[document.id] ?? [];
                    const sharedUserSubs = new Set(
                      documentShares.map((share) => share.userSub),
                    );
                    const shareableMembers =
                      workspace?.members.filter(
                        (member) =>
                          member.userSub !== session.user.sub &&
                          !sharedUserSubs.has(member.userSub),
                      ) ?? [];
                    const selectedRecipient =
                      shareRecipientsByDocumentId[document.id] ?? '';

                    return (
                      <>
                        <div className="document-card-topline">
                          <span className="document-type">
                            {documentTypeLabel(document.contentType)}
                          </span>
                          <span>{formatBytes(document.sizeBytes)}</span>
                        </div>
                        <h3>{document.fileName}</h3>
                        <p>Uploaded by {document.uploaderSub}</p>
                        <p>{formatDate(document.uploadedAt)}</p>
                        <div className="document-actions">
                          <a
                            className="button secondary-button compact-button"
                            href={projectDocumentViewerUrl(
                              document.projectId,
                              document.id,
                            )}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View
                          </a>
                          <a
                            className="button secondary-button compact-button"
                            href={`${projectDocumentUrl(
                              document.workspaceId,
                              document.projectId,
                              document.id,
                            )}/download`}
                          >
                            Download
                          </a>
                        </div>
                        {canManage ? (
                          <div
                            className="share-controls"
                            role="dialog"
                            aria-label={`Share ${document.fileName}`}
                          >
                            <div>
                              <p className="share-heading">Shared with</p>
                              {documentShares.length === 0 ? (
                                <p>No direct shares.</p>
                              ) : (
                                <ul className="share-list">
                                  {documentShares.map((share) => (
                                    <li key={share.userSub}>
                                      <span>
                                        {workspaceMemberLabel(
                                          workspace,
                                          share.userSub,
                                        )}
                                      </span>
                                      <button
                                        className="button secondary-button compact-button"
                                        type="button"
                                        disabled={
                                          shareStatus.type === 'loading' &&
                                          shareStatus.documentId === document.id
                                        }
                                        onClick={() =>
                                          void removeDocumentShare(
                                            document,
                                            share.userSub,
                                          )
                                        }
                                      >
                                        Remove
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <form
                              className="share-form"
                              onSubmit={(event) =>
                                void submitDocumentShare(event, document)
                              }
                            >
                              <label htmlFor={`share-${document.id}`}>
                                Share with
                              </label>
                              <div className="share-form-row">
                                <select
                                  id={`share-${document.id}`}
                                  value={selectedRecipient}
                                  disabled={shareableMembers.length === 0}
                                  onChange={(event) => {
                                    const userSub = event.target.value;
                                    setShareRecipientsByDocumentId(
                                      (currentRecipients) => ({
                                        ...currentRecipients,
                                        [document.id]: userSub,
                                      }),
                                    );
                                  }}
                                >
                                  <option value="">
                                    {shareableMembers.length === 0
                                      ? 'No more users'
                                      : 'Choose user'}
                                  </option>
                                  {shareableMembers.map((member) => (
                                    <option
                                      key={member.userSub}
                                      value={member.userSub}
                                    >
                                      {member.userSub} ({member.role})
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className="button primary-button compact-button"
                                  type="submit"
                                  disabled={
                                    !selectedRecipient ||
                                    (shareStatus.type === 'loading' &&
                                      shareStatus.documentId === document.id)
                                  }
                                >
                                  Share
                                </button>
                              </div>
                            </form>
                            {shareStatus.documentId === document.id &&
                            shareStatus.message ? (
                              <p
                                className={
                                  shareStatus.type === 'error'
                                    ? 'inline-alert'
                                    : shareStatus.type === 'success'
                                      ? 'share-status success-text'
                                      : 'share-status'
                                }
                              >
                                {shareStatus.message}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {project && canManage ? (
        <section className="workspace-panel" aria-labelledby="edit-project">
          <div>
            <p className="eyebrow">Edit project</p>
            <h2 id="edit-project">Update project details.</h2>
          </div>
          <form className="project-form" onSubmit={submitProjectUpdate}>
            <label htmlFor="edit-project-name">Project name</label>
            <input
              id="edit-project-name"
              value={projectName}
              maxLength={projectNameMaxLength}
              aria-invalid={formErrors.name ? 'true' : undefined}
              aria-describedby={
                formErrors.name ? 'edit-project-name-error' : undefined
              }
              onChange={(event) => {
                setProjectName(event.target.value);
                setFormErrors((currentErrors) => ({
                  ...currentErrors,
                  name: undefined,
                }));
              }}
            />
            {formErrors.name ? (
              <p className="field-error" id="edit-project-name-error">
                {formErrors.name}
              </p>
            ) : null}
            <label htmlFor="edit-project-description">Description</label>
            <textarea
              id="edit-project-description"
              value={projectDescription}
              maxLength={projectDescriptionMaxLength}
              aria-invalid={formErrors.description ? 'true' : undefined}
              aria-describedby={
                formErrors.description
                  ? 'edit-project-description-error'
                  : 'edit-project-description-hint'
              }
              onChange={(event) => {
                setProjectDescription(event.target.value);
                setFormErrors((currentErrors) => ({
                  ...currentErrors,
                  description: undefined,
                }));
              }}
            />
            {formErrors.description ? (
              <p className="field-error" id="edit-project-description-error">
                {formErrors.description}
              </p>
            ) : (
              <p className="field-hint" id="edit-project-description-hint">
                Optional. Up to {projectDescriptionMaxLength} characters.
              </p>
            )}
            <button
              className="button primary-button"
              type="submit"
              disabled={status.type === 'loading'}
            >
              Save project
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}

function ProjectDocumentViewerScreen({
  projectId,
  documentId,
}: {
  projectId: string;
  documentId: string;
}) {
  const { state } = useAuth();
  const session = signedInSession(state);
  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [document, setDocument] = useState<ProjectDocumentResponse | null>(
    null,
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [status, setStatus] = useState<
    | { type: 'idle'; message: string | null }
    | { type: 'loading'; message: string }
    | { type: 'error'; message: string }
  >({ type: 'idle', message: null });

  useEffect(() => {
    const workspaceId = window.localStorage.getItem(activeWorkspaceStorageKey);

    if (!workspaceId || document || status.type !== 'idle') {
      return;
    }

    async function loadDocument() {
      setStatus({ type: 'loading', message: 'Loading document.' });

      try {
        const [projectDetails, projectDocuments] = await Promise.all([
          fetchProjectDetails(workspaceId, projectId),
          fetchProjectDocuments(workspaceId, projectId),
        ]);
        const matchingDocument =
          projectDocuments.find(
            (projectDocument) => projectDocument.id === documentId,
          ) ?? null;

        if (!matchingDocument) {
          setStatus({
            type: 'error',
            message:
              'This document is unavailable or you no longer have access.',
          });
          return;
        }

        setProject(projectDetails);
        setDocument(matchingDocument);
        setStatus({ type: 'idle', message: null });
      } catch (error) {
        setStatus({
          type: 'error',
          message:
            error instanceof Error ? error.message : 'Unable to load document.',
        });
      }
    }

    void loadDocument();
  }, [document, documentId, projectId, status.type]);

  if (!session) {
    return null;
  }

  if (!window.localStorage.getItem(activeWorkspaceStorageKey)) {
    return (
      <main className="app-shell centered-shell">
        <StatusPanel title="Workspace required" tone="neutral">
          <p>Open a workspace before viewing documents.</p>
          <a className="button primary-button" href="/dashboard">
            Open dashboard
          </a>
        </StatusPanel>
      </main>
    );
  }

  const viewerUrl = document
    ? projectDocumentUrl(document.workspaceId, document.projectId, document.id)
    : '';
  const downloadUrl = document ? `${viewerUrl}/download` : '';
  const isImage = document?.contentType.startsWith('image/') ?? false;
  const isPdf = document?.contentType === 'application/pdf';
  const canPreview = isImage || isPdf;

  return (
    <main className="app-shell signed-in-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Document viewer</p>
          <h1>{document?.fileName ?? 'Document'}</h1>
        </div>
        <div className="topbar-actions">
          <UserBadge user={session.user} />
          <a
            className="button secondary-button"
            href={`/projects/${encodeURIComponent(projectId)}`}
          >
            Project
          </a>
        </div>
      </header>

      {status.type !== 'idle' || status.message ? (
        <p
          className={
            status.type === 'error' ? 'inline-alert dashboard-alert' : 'notice'
          }
        >
          {status.message}
        </p>
      ) : null}

      {document ? (
        <section className="workspace-panel viewer-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                {documentTypeLabel(document.contentType)}
              </p>
              <h2>{project?.name ?? 'Project document'}</h2>
            </div>
            <a className="button primary-button" href={downloadUrl}>
              Download
            </a>
          </div>
          <p>
            Uploaded by {document.uploaderSub} -{' '}
            {formatBytes(document.sizeBytes)}
          </p>
          {previewError ? (
            <p className="inline-alert dashboard-alert">{previewError}</p>
          ) : null}
          {canPreview ? (
            isImage ? (
              <img
                className="document-viewer-image"
                src={viewerUrl}
                alt={document.fileName}
                onError={() =>
                  setPreviewError(
                    'The image preview is unavailable. Use Download to save the file.',
                  )
                }
              />
            ) : (
              <iframe
                className="document-viewer-frame"
                src={viewerUrl}
                title={document.fileName}
              />
            )
          ) : (
            <div className="viewer-fallback">
              <p>This file type cannot be previewed in the browser.</p>
              <a className="button primary-button" href={downloadUrl}>
                Download file
              </a>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}

function InvitationAcceptScreen() {
  const { state } = useAuth();
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get('token') ?? '',
    [],
  );
  const [acceptance, setAcceptance] = useState<
    | { type: 'idle' }
    | { type: 'joining' }
    | {
        type: 'joined';
        workspace: WorkspaceDetailsResponse;
        membership: InvitationAcceptResponse['membership'];
      }
    | { type: 'error'; message: string }
  >({ type: 'idle' });

  useEffect(() => {
    if (state.status !== 'signed-in' || !token || acceptance.type !== 'idle') {
      return;
    }

    async function acceptInvitation() {
      setAcceptance({ type: 'joining' });

      try {
        const result = await acceptInvitationToken(token);
        const workspace = await fetchWorkspaceDetails(
          result.membership.workspaceId,
        );

        window.localStorage.setItem(
          activeWorkspaceStorageKey,
          result.membership.workspaceId,
        );
        setAcceptance({
          type: 'joined',
          workspace,
          membership: result.membership,
        });
      } catch (error) {
        setAcceptance({
          type: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to accept this invitation.',
        });
      }
    }

    void acceptInvitation();
  }, [state.status, token, acceptance.type]);

  if (!token) {
    return (
      <main className="app-shell centered-shell">
        <StatusPanel title="Invitation unavailable" tone="warning">
          <p>This invitation link is missing its secure token.</p>
          <a className="button primary-button" href="/dashboard">
            Open dashboard
          </a>
        </StatusPanel>
      </main>
    );
  }

  if (state.status === 'loading') {
    return (
      <main className="app-shell centered-shell">
        <StatusPanel title="Checking your session" tone="neutral">
          <p>One moment while the secure session is confirmed.</p>
        </StatusPanel>
      </main>
    );
  }

  if (state.status === 'signed-out') {
    const returnTo = `${window.location.pathname}${window.location.search}`;

    return (
      <main className="app-shell centered-shell">
        <section className="form-panel" aria-labelledby="invite-signin-title">
          <p className="eyebrow">Workspace invitation</p>
          <h1 id="invite-signin-title">Sign in to join.</h1>
          <p className="summary compact-summary">
            Continue through the secure sign-in service. After sign-in, this
            invitation page will finish adding your verified account.
          </p>
          <a
            className="button primary-button full-button"
            href={`/api/auth/login?return_to=${encodeURIComponent(returnTo)}`}
          >
            Continue securely
          </a>
        </section>
      </main>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <main className="app-shell centered-shell">
        <StatusPanel title="Session unavailable" tone="warning">
          <p>{state.message}</p>
          <a className="button primary-button" href="/login">
            Sign in again
          </a>
        </StatusPanel>
      </main>
    );
  }

  if (acceptance.type === 'joined') {
    return (
      <main className="app-shell centered-shell">
        <StatusPanel title="Workspace joined" tone="success">
          <p>
            You joined {acceptance.workspace.workspace.name} as{' '}
            {acceptance.membership.role}.
          </p>
          <a className="button primary-button" href="/dashboard">
            Open workspace
          </a>
        </StatusPanel>
      </main>
    );
  }

  if (acceptance.type === 'error') {
    return (
      <main className="app-shell centered-shell">
        <StatusPanel title="Invitation unavailable" tone="warning">
          <p>{friendlyInvitationError(acceptance.message)}</p>
          <a className="button primary-button" href="/dashboard">
            Open dashboard
          </a>
        </StatusPanel>
      </main>
    );
  }

  return (
    <main className="app-shell centered-shell">
      <StatusPanel title="Joining workspace" tone="neutral">
        <p>Confirming the invitation and adding your verified account.</p>
      </StatusPanel>
    </main>
  );
}

async function createWorkspaceRequest(
  name: string,
): Promise<WorkspaceDetailsResponse> {
  const response = await apiFetch('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

  return readApiResponse<WorkspaceDetailsResponse>(response);
}

async function fetchWorkspaceDetails(
  workspaceId: string,
): Promise<WorkspaceDetailsResponse> {
  const response = await apiFetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}`,
  );

  return readApiResponse<WorkspaceDetailsResponse>(response);
}

async function fetchPendingInvitations(
  workspaceId: string,
): Promise<WorkspaceInvitationResponse[]> {
  const response = await apiFetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/invitations`,
  );
  const body = await readApiResponse<PendingInvitationsResponse>(response);

  return body.invitations;
}

async function fetchProjects(workspaceId: string): Promise<ProjectResponse[]> {
  const response = await apiFetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/projects`,
  );
  const body = await readApiResponse<ProjectListResponse>(response);

  return body.projects;
}

async function fetchWorkspaceActivity(
  workspaceId: string,
  input: { limit: number; offset: number; projectId: string | null },
): Promise<ActivityHistoryResponse> {
  const params = new URLSearchParams({
    limit: String(input.limit),
    offset: String(input.offset),
  });

  if (input.projectId) {
    params.set('projectId', input.projectId);
  }

  const response = await apiFetch(
    `/api/workspaces/${encodeURIComponent(
      workspaceId,
    )}/activity?${params.toString()}`,
  );

  return readApiResponse<ActivityHistoryResponse>(response);
}

async function fetchProjectDetails(
  workspaceId: string,
  projectId: string,
): Promise<ProjectResponse> {
  const response = await apiFetch(
    `/api/workspaces/${encodeURIComponent(
      workspaceId,
    )}/projects/${encodeURIComponent(projectId)}`,
  );
  const body = await readApiResponse<ProjectDetailsResponse>(response);

  return body.project;
}

async function fetchProjectDocuments(
  workspaceId: string,
  projectId: string,
): Promise<ProjectDocumentResponse[]> {
  const response = await apiFetch(
    `/api/workspaces/${encodeURIComponent(
      workspaceId,
    )}/projects/${encodeURIComponent(projectId)}/documents`,
  );
  const body = await readApiResponse<ProjectDocumentListResponse>(response);

  return body.documents;
}

async function fetchProjectDocumentShares(
  workspaceId: string,
  projectId: string,
  documentId: string,
): Promise<ProjectDocumentShareResponse[]> {
  const response = await apiFetch(
    `/api/workspaces/${encodeURIComponent(
      workspaceId,
    )}/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(
      documentId,
    )}/shares`,
  );
  const body =
    await readApiResponse<ProjectDocumentShareListResponse>(response);

  return body.shares;
}

async function shareProjectDocumentRequest(
  workspaceId: string,
  projectId: string,
  documentId: string,
  userSub: string,
): Promise<ProjectDocumentShareMutationResponse> {
  const response = await apiFetch(
    `/api/workspaces/${encodeURIComponent(
      workspaceId,
    )}/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(
      documentId,
    )}/shares`,
    {
      method: 'POST',
      body: JSON.stringify({ userSub }),
    },
  );

  return readApiResponse<ProjectDocumentShareMutationResponse>(response);
}

async function unshareProjectDocumentRequest(
  workspaceId: string,
  projectId: string,
  documentId: string,
  userSub: string,
): Promise<void> {
  const response = await apiFetch(
    `/api/workspaces/${encodeURIComponent(
      workspaceId,
    )}/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(
      documentId,
    )}/shares/${encodeURIComponent(userSub)}`,
    {
      method: 'DELETE',
    },
  );

  if (!response.ok) {
    await readApiResponse<unknown>(response);
  }
}

async function uploadProjectDocumentRequest(
  workspaceId: string,
  projectId: string,
  file: File | null,
  onProgress: (progress: number) => void,
): Promise<ProjectDocumentResponse> {
  if (!file) {
    throw new Error('Choose a document to upload.');
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open(
      'POST',
      `/api/workspaces/${encodeURIComponent(
        workspaceId,
      )}/projects/${encodeURIComponent(projectId)}/documents`,
    );
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.setRequestHeader('X-File-Name', file.name);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => reject(new Error('Unable to upload document.'));
    xhr.onload = () => {
      const body = parseJsonResponse(xhr.responseText) as {
        document?: ProjectDocumentResponse;
        error?: unknown;
      } | null;

      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new Error(
            typeof body?.error === 'string'
              ? body.error
              : `Upload failed with ${xhr.status}`,
          ),
        );
        return;
      }

      if (!body?.document) {
        reject(new Error('Upload response was missing the document.'));
        return;
      }

      resolve(body.document);
    };
    xhr.send(file);
  });
}

async function createProjectRequest(
  workspaceId: string,
  name: string,
  description: string,
): Promise<ProjectResponse> {
  const response = await apiFetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/projects`,
    {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    },
  );
  const body = await readApiResponse<ProjectDetailsResponse>(response);

  return body.project;
}

async function updateProjectRequest(
  workspaceId: string,
  projectId: string,
  name: string,
  description: string,
): Promise<ProjectResponse> {
  const response = await apiFetch(
    `/api/workspaces/${encodeURIComponent(
      workspaceId,
    )}/projects/${encodeURIComponent(projectId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name, description }),
    },
  );
  const body = await readApiResponse<ProjectDetailsResponse>(response);

  return body.project;
}

async function createWorkspaceInvitation(
  workspaceId: string,
  email: string,
  role: WorkspaceInvitationResponse['role'],
): Promise<void> {
  const response = await apiFetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/invitations`,
    {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    },
  );

  await readApiResponse<unknown>(response);
}

async function revokeWorkspaceInvitation(
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  const response = await apiFetch(
    `/api/workspaces/${encodeURIComponent(
      workspaceId,
    )}/invitations/${encodeURIComponent(invitationId)}`,
    {
      method: 'DELETE',
    },
  );

  await readApiResponse<unknown>(response);
}

async function acceptInvitationToken(
  token: string,
): Promise<InvitationAcceptResponse> {
  const response = await apiFetch('/api/workspaces/invitations/accept', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });

  return readApiResponse<InvitationAcceptResponse>(response);
}

async function readApiResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;

  if (!response.ok) {
    throw new Error(
      typeof body?.error === 'string'
        ? body.error
        : `Request failed with ${response.status}`,
    );
  }

  return body as T;
}

function StatusPanel({
  title,
  tone,
  children,
}: {
  title: string;
  tone: 'success' | 'warning' | 'neutral';
  children: React.ReactNode;
}) {
  return (
    <section className={`status-panel status-panel-${tone}`}>
      <span className="status-mark" aria-hidden="true" />
      <div>
        <h1>{title}</h1>
        {children}
      </div>
    </section>
  );
}

function UserBadge({ user }: { user: CurrentUser }) {
  return (
    <aside className="user-badge" aria-label="Current user">
      {user.pictureUrl ? (
        <img src={user.pictureUrl} alt="" />
      ) : (
        <span className="avatar-fallback">{initialFor(user)}</span>
      )}
      <div>
        <strong>{user.name ?? user.email}</strong>
        <span>{user.email}</span>
      </div>
    </aside>
  );
}

function DocumentPreview() {
  return (
    <aside className="document-preview" aria-label="Document workspace preview">
      <div className="preview-toolbar">
        <span />
        <span />
        <span />
      </div>
      <div className="preview-row strong-row" />
      <div className="preview-row" />
      <div className="preview-row short-row" />
      <div className="preview-list">
        <span>Workspaces</span>
        <span>Projects</span>
        <span>Shared</span>
      </div>
    </aside>
  );
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateProjectForm(values: ProjectFormValues):
  | { ok: true; values: ProjectFormValues }
  | {
      ok: false;
      errors: ProjectFormErrors;
    } {
  const name = values.name.trim();
  const description = values.description.trim();
  const errors: ProjectFormErrors = {};

  if (name.length === 0) {
    errors.name = 'Project name is required.';
  } else if (name.length > projectNameMaxLength) {
    errors.name = `Project name must be ${projectNameMaxLength} characters or fewer.`;
  }

  if (description.length > projectDescriptionMaxLength) {
    errors.description = `Description must be ${projectDescriptionMaxLength} characters or fewer.`;
  }

  if (errors.name || errors.description) {
    return { ok: false, errors };
  }

  return { ok: true, values: { name, description } };
}

function validateDocumentUploadFile(file: File | null): string | null {
  if (!file) {
    return 'Choose a document to upload.';
  }

  if (!acceptedDocumentContentTypes.has(file.type)) {
    return 'Upload a PDF, PNG, JPEG, GIF, or WebP file.';
  }

  if (file.size <= 0) {
    return 'Upload a non-empty file.';
  }

  if (file.size > maxDocumentUploadBytes) {
    return `Document must be ${formatBytes(maxDocumentUploadBytes)} or smaller.`;
  }

  return null;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  const units = ['KB', 'MB', 'GB'];
  let amount = value / 1024;
  let unitIndex = 0;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${
    units[unitIndex]
  }`;
}

function documentTypeLabel(contentType: string): string {
  if (contentType === 'application/pdf') {
    return 'PDF';
  }

  if (contentType.startsWith('image/')) {
    return contentType.replace('image/', '').toUpperCase();
  }

  return 'File';
}

function projectDocumentUrl(
  workspaceId: string,
  projectId: string,
  documentId: string,
): string {
  return `/api/workspaces/${encodeURIComponent(
    workspaceId,
  )}/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(
    documentId,
  )}`;
}

function projectDocumentViewerUrl(
  projectId: string,
  documentId: string,
): string {
  return `/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(
    documentId,
  )}`;
}

function parseJsonResponse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function canManageProjects(role: WorkspaceRole | undefined): boolean {
  return role === 'owner' || role === 'member';
}

function upsertDocumentShare(
  shares: ProjectDocumentShareResponse[],
  nextShare: ProjectDocumentShareResponse,
): ProjectDocumentShareResponse[] {
  const withoutExistingShare = shares.filter(
    (share) => share.userSub !== nextShare.userSub,
  );

  return [...withoutExistingShare, nextShare].sort((left, right) =>
    left.userSub.localeCompare(right.userSub),
  );
}

function workspaceMemberLabel(
  workspace: WorkspaceDetailsResponse | null,
  userSub: string,
): string {
  const member = workspace?.members.find(
    (workspaceMember) => workspaceMember.userSub === userSub,
  );

  return member ? `${member.userSub} (${member.role})` : userSub;
}

function activityTimelineCopy(
  activity: ActivityEntryResponse,
  projectNames: Map<string, string>,
): { title: string; detail: string } {
  const projectName = activity.projectId
    ? (projectNames.get(activity.projectId) ?? 'Project')
    : 'Workspace';

  switch (activity.action) {
    case 'user_joined':
      return {
        title: 'Joined workspace',
        detail: activityMetadataText(activity.metadata, 'role')
          ? `${activity.actorSub} joined as ${activityMetadataText(
              activity.metadata,
              'role',
            )}.`
          : `${activity.actorSub} joined the workspace.`,
      };
    case 'invitation_sent':
      return {
        title: 'Invitation sent',
        detail: `Sent to ${activityMetadataText(
          activity.metadata,
          'email',
          'a workspace user',
        )} for ${projectName}.`,
      };
    case 'invitation_accepted':
      return {
        title: 'Invitation accepted',
        detail: `${activity.actorSub} accepted access to ${projectName}.`,
      };
    case 'project_created':
      return {
        title: 'Project created',
        detail: `${activityMetadataText(
          activity.metadata,
          'name',
          projectName,
        )} was added to the workspace.`,
      };
    case 'document_uploaded':
      return {
        title: 'Document uploaded',
        detail: `${activityMetadataText(
          activity.metadata,
          'fileName',
          'A document',
        )} was uploaded to ${projectName}.`,
      };
    case 'document_shared':
      return {
        title: 'Document shared',
        detail: `${projectName} document shared with ${activityMetadataText(
          activity.metadata,
          'sharedWithEmail',
          activityMetadataText(activity.metadata, 'sharedWithSub', 'a user'),
        )}.`,
      };
  }
}

function activityMetadataText(
  metadata: Record<string, unknown>,
  key: string,
  fallback = '',
): string {
  const value = metadata[key];

  return typeof value === 'string' && value.trim().length > 0
    ? value
    : fallback;
}

function friendlyInvitationError(message: string): string {
  if (/expired/i.test(message)) {
    return 'This invitation has expired. Ask the workspace owner for a new invite.';
  }

  if (/already been used/i.test(message)) {
    return 'This invitation has already been used. Open the dashboard to continue.';
  }

  if (/different email/i.test(message)) {
    return 'This invitation was sent to a different verified email address.';
  }

  return message;
}

function initialFor(user: CurrentUser): string {
  return (user.name ?? user.email).trim().charAt(0).toUpperCase();
}

function signedInSession(state: AuthState): AuthSessionResponse | null {
  return state.status === 'signed-in' ? state.data : null;
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
