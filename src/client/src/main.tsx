import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { AuthSessionResponse, CurrentUser } from '../../shared/auth';

import './styles.css';

type SessionState =
  | { status: 'loading' }
  | { status: 'signed-in'; data: AuthSessionResponse }
  | { status: 'signed-out' }
  | { status: 'unavailable'; message: string };

type VerificationStatus = 'success' | 'expired' | 'unknown';

function App() {
  const path = window.location.pathname;

  if (path === '/signup') {
    return <SignUpScreen />;
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
  const session = useSession();

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
    return <SignedInHome session={session.data} />;
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
            <a className="button primary-button" href="/api/auth/login">
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

function SignedInHome({ session }: { session: AuthSessionResponse }) {
  return (
    <main className="app-shell signed-in-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Signed in</p>
          <h1>Document workspace</h1>
        </div>
        <UserBadge user={session.user} />
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
          Already have access? <a href="/api/auth/login">Sign in</a>
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
          <a className="button primary-button" href="/api/auth/login">
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
          <a className="button primary-button" href="/api/auth/login">
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

function useSession(): SessionState {
  const [session, setSession] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    async function loadSession() {
      try {
        const response = await fetch('/api/auth/session', {
          signal: controller.signal,
        });

        if (response.status === 401 || response.status === 403) {
          setSession({ status: 'signed-out' });
          return;
        }

        if (!response.ok) {
          throw new Error(`Session check failed with ${response.status}`);
        }

        setSession({
          status: 'signed-in',
          data: (await response.json()) as AuthSessionResponse,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setSession({
          status: 'unavailable',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to confirm the current session.',
        });
      }
    }

    void loadSession();

    return () => controller.abort();
  }, []);

  return session;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function initialFor(user: CurrentUser): string {
  return (user.name ?? user.email).trim().charAt(0).toUpperCase();
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
