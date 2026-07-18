export type HealthStatus = 'ok' | 'error';

export interface DatabaseHealth {
  status: HealthStatus;
  latencyMs?: number;
  serverTime?: string;
}

export interface HealthResponse {
  status: HealthStatus;
  service: 'api';
  timestamp: string;
  database: DatabaseHealth;
}
