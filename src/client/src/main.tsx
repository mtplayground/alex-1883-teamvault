import { StrictMode, useMemo, useState } from 'react';
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

  if (path === '/signup/check-email') {
    return <CheckEmailScreen />;
  }

  if (path === '/verify') {
    return <VerificationResultScreen />;
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

  if (!session) {
    return null;
  }

  return (
    <main className="app-shell signed-in-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Signed in</p>
          <h1>Document workspace</h1>
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
          <span className="metric-value">0</span>
          <h2>Workspaces</h2>
          <p>Create a workspace to organize teams, projects, and documents.</p>
        </article>
        <article className="metric-panel">
          <span className="metric-value">0</span>
          <h2>Projects</h2>
          <p>Projects will appear here once workspace setup is complete.</p>
        </article>
        <article className="metric-panel">
          <span className="metric-value">0</span>
          <h2>Shared documents</h2>
          <p>Documents shared with you will be listed in this view.</p>
        </article>
      </section>

      <section className="activity-panel" aria-labelledby="activity-title">
        <div>
          <h2 id="activity-title">
            {session.isNew ? 'Registration complete.' : session.message}
          </h2>
          <p>
            Your secure session is active. Workspace and document tools will
            unlock as the next product areas are added.
          </p>
        </div>
      </section>
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
