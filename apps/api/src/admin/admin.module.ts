import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/**
 * Admin operational surface - see plan.md Phase 8. DRIZZLE is provided by the @Global()
 * DrizzleModule (db/drizzle.module.ts), so no explicit import is needed here, same as
 * drivers.module.ts/vehicles.module.ts.
 */
@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
