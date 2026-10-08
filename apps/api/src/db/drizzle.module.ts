import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE');
export const PG_POOL = Symbol('PG_POOL');

export type DrizzleDb = NodePgDatabase<typeof schema>;

/**
 * Closes the raw `pg` `Pool` on app shutdown. Previously nothing ever called `pool.end()`:
 * `DRIZZLE`'s own factory below only ever constructed a `Pool`, with no corresponding lifecycle
 * hook to close it, so this connection pool leaked past every `app.close()` - part of the same
 * gap docs/open-items.md #19 describes for BullMQ's ioredis connections, just for Postgres
 * instead of Redis, and found while fixing that item (`app.enableShutdownHooks()` alone wasn't
 * enough to silence "Jest did not exit" - this was the other open handle). Implemented as its
 * own tiny provider (not inline in the `DRIZZLE` factory) so the `Pool` instance is reachable by
 * Nest's shutdown hook independently of the `DrizzleDb` wrapper `drizzle()` returns, which does
 * not expose the underlying pool.
 */
class PgPoolCloser implements OnApplicationShutdown {
  constructor(private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool => new Pool({ connectionString: config.get<string>('DATABASE_URL') }),
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): DrizzleDb => drizzle(pool, { schema }),
    },
    {
      provide: PgPoolCloser,
      inject: [PG_POOL],
      useFactory: (pool: Pool): PgPoolCloser => new PgPoolCloser(pool),
    },
  ],
  exports: [DRIZZLE],
})
export class DrizzleModule {}
