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

const activeWorkspaceStorageKey = 'active-workspace-id';

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
  const [status, setStatus] = useState<
    | { type: 'idle'; message: string | null }
    | { type: 'loading'; message: string }
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

    const name = projectName.trim();
    if (name.length === 0) {
      setStatus({ type: 'error', message: 'Project name is required.' });
      return;
    }

    setStatus({ type: 'loading', message: 'Creating project.' });

    try {
      const project = await createProjectRequest(
        workspace.workspace.id,
        name,
        projectDescription,
      );

      setProjects((currentProjects) => [project, ...currentProjects]);
      setProjectName('');
      setProjectDescription('');
      setStatus({ type: 'idle', message: 'Project created.' });
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
            status.type === 'error' ? 'inline-alert dashboard-alert' : 'notice'
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
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Launch plan"
            />
            <label htmlFor="project-description">Description</label>
            <textarea
              id="project-description"
              value={projectDescription}
              onChange={(event) => setProjectDescription(event.target.value)}
              placeholder="Notes, files, and milestones"
            />
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

function ProjectDetailScreen({ projectId }: { projectId: string }) {
  const { state } = useAuth();
  const session = signedInSession(state);
  const [workspace, setWorkspace] = useState<WorkspaceDetailsResponse | null>(
    null,
  );
  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [status, setStatus] = useState<
    | { type: 'idle'; message: string | null }
    | { type: 'loading'; message: string }
    | { type: 'error'; message: string }
  >({ type: 'idle', message: null });
  const currentRole = workspace?.members.find(
    (member) => member.userSub === session?.user.sub,
  )?.role;
  const canManage = currentRole ? canManageProjects(currentRole) : false;

  useEffect(() => {
    const workspaceId = window.localStorage.getItem(activeWorkspaceStorageKey);

    if (!workspaceId || project || status.type !== 'idle') {
      return;
    }

    async function loadProject() {
      setStatus({ type: 'loading', message: 'Loading project.' });

      try {
        const [workspaceDetails, projectDetails] = await Promise.all([
          fetchWorkspaceDetails(workspaceId),
          fetchProjectDetails(workspaceId, projectId),
        ]);

        setWorkspace(workspaceDetails);
        setProject(projectDetails);
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
  }, [project, projectId, status.type]);

  async function submitProjectUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!workspace || !project || !canManage) {
      return;
    }

    const name = projectName.trim();
    if (name.length === 0) {
      setStatus({ type: 'error', message: 'Project name is required.' });
      return;
    }

    setStatus({ type: 'loading', message: 'Saving project.' });

    try {
      const updatedProject = await updateProjectRequest(
        workspace.workspace.id,
        project.id,
        name,
        projectDescription,
      );

      setProject(updatedProject);
      setProjectName(updatedProject.name);
      setProjectDescription(updatedProject.description ?? '');
      setStatus({ type: 'idle', message: 'Project saved.' });
    } catch (error) {
      setStatus({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Unable to save project.',
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
            status.type === 'error' ? 'inline-alert dashboard-alert' : 'notice'
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
              onChange={(event) => setProjectName(event.target.value)}
            />
            <label htmlFor="edit-project-description">Description</label>
            <textarea
              id="edit-project-description"
              value={projectDescription}
              onChange={(event) => setProjectDescription(event.target.value)}
            />
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function canManageProjects(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'member';
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
