export type HealthStatus = 'ok';

export interface HealthResponse {
  status: HealthStatus;
  service: 'api';
  timestamp: string;
}
