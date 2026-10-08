import { Controller, Get, Inject, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/drizzle.module';
import { HealthRedisService } from './health-redis.service';

/**
 * Exempted from the global rate limit (docs/open-items.md) - an orchestrator/load-balancer
 * polling `/health`/`/health/ready`/`/health/live` frequently is normal, expected traffic, not
 * abuse, and getting 429'd here would make the orchestrator wrongly think the process is down.
 */
@SkipThrottle()
@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly redis: HealthRedisService,
  ) {}

  @Get()
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('live')
  liveProbe(): { status: string } {
    return { status: 'ok' };
  }

  /**
   * Checks both dependencies this process actually needs to serve traffic correctly - Postgres
   * (pre-existing) and, as of this task, Redis (BullMQ queues, live-location cache, the socket.io
   * adapter all depend on it). Either one being unreachable fails readiness with 503; `/health`/
   * `/health/live` deliberately do NOT check dependencies, so a slow/down downstream never fails
   * liveness (which would make an orchestrator kill/restart a perfectly healthy process).
   */
  @Get('ready')
  async ready(): Promise<{ status: string }> {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException('Database is not reachable');
    }

    try {
      await this.redis.ping();
    } catch {
      throw new ServiceUnavailableException('Redis is not reachable');
    }

    return { status: 'ok' };
  }
}
