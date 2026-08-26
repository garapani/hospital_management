import { MetricsService } from './metrics.service.js';

describe('MetricsService', () => {
  let metricsService: MetricsService;

  beforeEach(() => {
    metricsService = new MetricsService();
    metricsService.onModuleInit();
  });

  it('records HTTP requests and exposes them in the Prometheus text format', async () => {
    metricsService.recordHttpRequest('POST', '/api/patients', 201, 'tenant_demo', 12.5);
    metricsService.recordHttpRequest('GET', '/api/patients', 200, 'tenant_demo', 3);

    const text = await metricsService.metricsText();
    expect(text).toContain('http_requests_total');
    expect(text).toContain('http_request_duration_seconds');
    // Default process metrics are collected too.
    expect(text).toContain('process_cpu_seconds_total');
    // The labeled series is present for the recorded request.
    expect(text).toMatch(/http_requests_total\{method="POST",route="\/api\/patients",status="201",tenant="tenant_demo"\} 1/);
  });

  it('labels unknown tenants as unknown', async () => {
    metricsService.recordHttpRequest('GET', '/api/auth/login', 401, undefined, 1);
    const text = await metricsService.metricsText();
    expect(text).toContain('tenant="unknown"');
  });

  it('serves the correct content type', () => {
    expect(metricsService.contentType()).toContain('text/plain');
  });
});
