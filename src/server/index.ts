import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from 'express';

import type { HealthResponse } from '../shared/health.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const host = process.env.HOST ?? '0.0.0.0';
const port = Number.parseInt(process.env.PORT ?? '8080', 10);
const clientDistPath = path.resolve(__dirname, '../../client');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json());

const healthHandler: RequestHandler = (_req, res) => {
  const body: HealthResponse = {
    status: 'ok',
    service: 'api',
    timestamp: new Date().toISOString(),
  };

  res.json(body);
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

app.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});
