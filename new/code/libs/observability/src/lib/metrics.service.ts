import { Injectable, OnModuleInit } from '@nestjs/common';
import { IncomingMessage } from 'node:http';
import { ServerResponse } from 'node:http';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

/**
 * Prometheus metrics: default process/event-loop metrics plus an HTTP request histogram and
 * counter labeled with method, route, status, and tenant id. `GET /metrics` (MetricsController)
 * serves `register.metrics()` in the Prometheus text format.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly register = new Registry();
  private readonly httpRequestDuration: Histogram<string>;
  private readonly httpRequestsTotal: Counter<string>;

  constructor() {
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status', 'tenant'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.register],
    });
    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status', 'tenant'],
      registers: [this.register],
    });
  }

  onModuleInit(): void {
    collectDefaultMetrics({ register: this.register });
  }

  /** Called by the HTTP middleware after a response finishes. */
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    tenantId: string | undefined,
    durationMs: number,
  ): void {
    const labels = {
      method,
      route,
      status: String(statusCode),
      tenant: tenantId ?? 'unknown',
    };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, durationMs / 1000);
  }

  metricsText(): Promise<string> {
    return this.register.metrics();
  }

  contentType(): string {
    return this.register.contentType;
  }

  // Exposed for tests.
  getRegistry(): Registry {
    return this.register;
  }
}

/**
 * Express-style middleware that times every request and records it on the MetricsService. The
 * route label is the matched Express route pattern (or the path when unmatched); the tenant label
 * comes from the request's authContext (populated before this middleware runs).
 */
export function metricsMiddleware(metricsService: MetricsService) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const method = req.method ?? 'UNKNOWN';
      const status = res.statusCode ?? 0;
      const route = (req as IncomingMessage & { route?: { path?: string } }).route?.path ?? (req.url ?? '');
      const authContext = (req as IncomingMessage & { authContext?: { hospitalId?: string } }).authContext;
      metricsService.recordHttpRequest(method, route, status, authContext?.hospitalId, durationMs);
    });
    next();
  };
}
