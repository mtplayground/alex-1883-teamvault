import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { HealthResponse } from '../../shared/health';

import './styles.css';

type HealthState =
  | { status: 'loading' }
  | { status: 'ready'; data: HealthResponse }
  | { status: 'error'; message: string };

function App() {
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    async function loadHealth() {
      try {
        const response = await fetch('/api/health', {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Health check failed with ${response.status}`);
        }

        setHealth({
          status: 'ready',
          data: (await response.json()) as HealthResponse,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setHealth({
          status: 'error',
          message:
            error instanceof Error ? error.message : 'Unable to reach the API',
        });
      }
    }

    void loadHealth();

    return () => controller.abort();
  }, []);

  return (
    <main className="app-shell">
      <section className="intro-panel" aria-labelledby="app-title">
        <div>
          <p className="eyebrow">Project skeleton</p>
          <h1 id="app-title">Document workspace foundation</h1>
          <p className="summary">
            A single-page frontend and backend service are wired together for
            the upcoming account, workspace, project, and document flows.
          </p>
        </div>
        <HealthCard health={health} />
      </section>
    </main>
  );
}

function HealthCard({ health }: { health: HealthState }) {
  return (
    <aside className="health-card" aria-live="polite">
      <span className={`status-dot status-${health.status}`} />
      <div>
        <h2>API health</h2>
        {health.status === 'loading' ? (
          <p>Checking backend service...</p>
        ) : health.status === 'error' ? (
          <p>{health.message}</p>
        ) : (
          <p>
            {health.data.status}:{health.data.service} with PostgreSQL in{' '}
            {health.data.database.latencyMs}ms at{' '}
            {new Date(health.data.timestamp).toLocaleTimeString()}
          </p>
        )}
      </div>
    </aside>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
