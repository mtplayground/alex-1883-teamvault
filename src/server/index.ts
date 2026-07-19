import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from 'express';

import {
  readAuthConfig,
  readEmailConfig,
  readRuntimeConfig,
  readSelfUrl,
} from './config.js';
import { createAuthRouter } from './auth/routes.js';
import { closePool, smokeTestDatabase } from './db/pool.js';
import { createProjectRouter } from './projects/routes.js';
import { createWorkspaceRouter } from './workspaces/routes.js';
import type { HealthResponse } from '../shared/health.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = readRuntimeConfig(process.env);
const clientDistPath = path.resolve(__dirname, '../../client');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json());
app.use(
  '/api/auth',
  createAuthRouter({
    authConfig: readAuthConfig(process.env),
    selfUrl: process.env.SELF_URL ? readSelfUrl(process.env) : null,
  }),
);
app.use(
  '/api/workspaces',
  createWorkspaceRouter({
    authConfig: readAuthConfig(process.env),
    emailConfig: readEmailConfig(process.env),
    selfUrl: process.env.SELF_URL ? readSelfUrl(process.env) : null,
  }),
);
app.use(
  '/api/workspaces',
  createProjectRouter({
    authConfig: readAuthConfig(process.env),
  }),
);

const healthHandler: RequestHandler = async (_req, res) => {
  try {
    const database = await smokeTestDatabase();
    const body: HealthResponse = {
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
      database: {
        status: 'ok',
        latencyMs: database.latencyMs,
        serverTime: database.serverTime,
      },
    };

    res.json(body);
  } catch (error) {
    console.error('Health check failed', {
      name: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    const body: HealthResponse = {
      status: 'error',
      service: 'api',
      timestamp: new Date().toISOString(),
      database: {
        status: 'error',
      },
    };

    res.status(503).json(body);
  }
};

app.get('/api/health', healthHandler);

app.use(express.static(clientDistPath));

app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error('Unhandled request error', {
    name: err instanceof Error ? err.name : undefined,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });

  res.status(500).json({ error: 'Internal server error' });
};

app.use(errorHandler);

app.listen(config.server.port, config.server.host, () => {
  console.log(
    `Server listening on http://${config.server.host}:${config.server.port}`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void closePool().finally(() => {
      process.exit(0);
    });
  });
}
