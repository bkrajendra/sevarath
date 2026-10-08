import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { Pool } from 'pg';
import { DrizzleModule, PG_POOL } from './drizzle.module';

/**
 * Real-Postgres proof of docs/open-items.md #19's other half: the raw `pg` `Pool` `DRIZZLE`
 * wraps is actually closed on application shutdown, not just left open past `app.close()`.
 * Found while fixing #19 - silencing Jest's "did not exit" warning needed this too, not just
 * `app.enableShutdownHooks()` in `main.ts`/the e2e suites, since nothing previously called
 * `pool.end()` at all (see `PgPoolCloser` in `drizzle.module.ts`).
 *
 * Note `app.enableShutdownHooks()` itself is NOT what makes this work and is deliberately not
 * called here: Nest's `INestApplicationContext#close()` always runs the full destroy/shutdown
 * hook chain (`callDestroyHook` -> `callShutdownHook`, which is what invokes
 * `PgPoolCloser#onApplicationShutdown` below) on a plain `await app.close()`, with or without
 * `enableShutdownHooks()` - that method only wires an OS signal (SIGTERM/SIGINT) to *call*
 * `app.close()` automatically, which is why `main.ts` (which never calls `close()` itself, only
 * exits via a process signal) still needs it, while every e2e suite here calls `app.close()`
 * explicitly in its own `afterAll` and never needed the hook for this specific fix.
 */
describe('DrizzleModule (integration, real Postgres) - shutdown closes the pool', () => {
  it('ends the underlying pg Pool when the Nest application shuts down, via a plain app.close() with no enableShutdownHooks() call', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DrizzleModule],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const pool = app.get<Pool>(PG_POOL);
    expect(pool.ended).toBe(false);

    // Prove the pool is actually live before shutdown, not just un-ended by construction.
    const { rows } = await pool.query('SELECT 1 as one');
    expect(rows[0].one).toBe(1);

    await app.close();

    expect(pool.ended).toBe(true);
    await expect(pool.query('SELECT 1')).rejects.toThrow();
  });
});
