import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service.js';

/**
 * Serves the Prometheus metrics in the text exposition format. Deliberately NOT behind the
 * permission guard: Prometheus scrapers cannot carry JWTs, and the endpoint exposes only
 * aggregate counters (no PHI — the tenant label is an opaque hospitalId). Restrict at the proxy
 * level if the deployment needs it.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(): Promise<string> {
    return this.metricsService.metricsText();
  }
}
