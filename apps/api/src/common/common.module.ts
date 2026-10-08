import { Module } from '@nestjs/common';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';

/**
 * Cross-cutting housekeeping that doesn't belong to any single business module. Today that's
 * just `IdempotencyCleanupService` (docs/open-items.md #16) - it only depends on `DRIZZLE`
 * (provided globally by `DrizzleModule`) and `SchedulerRegistry` (provided globally by
 * `ScheduleModule.forRoot()` in `app.module.ts`), so it needs no imports of its own.
 */
@Module({
  providers: [IdempotencyCleanupService],
})
export class CommonModule {}
