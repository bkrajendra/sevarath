import { Controller, Get, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * `GET /metrics` in Prometheus text-exposition format - deliberately unauthenticated (no
 * `JwtAuthGuard`), unlike virtually every other route in this API. This is a documented
 * judgment call, not an oversight - see docs/open-items.md: a Prometheus scraper is normally on
 * an internal network, and this system has no separate internal-only port/listener story yet
 * (main.ts binds one HTTP server for everything). Flagged there for review rather than silently
 * guarded.
 *
 * `VERSION_NEUTRAL` + excluded from the global `/api` prefix in `main.ts` (same treatment as
 * `/health`/`/health/ready`/`/health/live`) - a metrics scraper expects a bare `/metrics` path,
 * not a versioned API route.
 *
 * `@SkipThrottle()` (docs/open-items.md, Phase 9 hardening/rate-limiting): a Prometheus scraper
 * hitting this every few seconds is normal, expected traffic, not abuse.
 */
@SkipThrottle()
@ApiTags('metrics')
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @ApiExcludeEndpoint()
  async scrape(@Res() res: Response): Promise<void> {
    res.set('Content-Type', this.metrics.contentType);
    res.send(await this.metrics.getMetrics());
  }
}
