import 'dotenv/config';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { lastValueFrom, of, throwError } from 'rxjs';
import * as schema from '../../db/schema';
import { idempotencyKeys, users } from '../../db/schema';
import { IdempotencyInterceptor } from './idempotency.interceptor';

function makeContext(
  headers: Record<string, string>,
  user: { userId: string },
  handlerName = 'create',
): ExecutionContext {
  const request = { headers, user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getClass: () => ({ name: 'RidesController' }),
    getHandler: () => ({ name: handlerName }),
  } as unknown as ExecutionContext;
}

function makeHandler(fn: () => unknown): CallHandler {
  return { handle: () => of(fn()) };
}

function makeFailingHandler(error: unknown): CallHandler {
  return { handle: () => throwError(() => error) };
}

describe('IdempotencyInterceptor (integration, real Postgres)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let interceptor: IdempotencyInterceptor;
  let userId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
    interceptor = new IdempotencyInterceptor(db as any);

    const [user] = await db
      .insert(users)
      .values({ name: 'Idempotency Interceptor Test User', mobile: `idem-interceptor-${Date.now()}` })
      .returning();
    userId = user.id;
  });

  afterEach(async () => {
    await db.delete(idempotencyKeys).where(eq(idempotencyKeys.userId, userId));
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  });

  it('claims a fresh key, runs the handler once, and leaves a COMPLETED row with the response body', async () => {
    const key = `key-${Date.now()}-fresh`;
    const context = makeContext({ 'idempotency-key': key }, { userId });
    let handlerCalls = 0;
    const handler = makeHandler(() => {
      handlerCalls += 1;
      return { id: 'ride-xyz', status: 'SEARCHING_DRIVER' };
    });

    const result = await lastValueFrom(interceptor.intercept(context, handler));

    expect(handlerCalls).toBe(1);
    expect(result).toEqual({ id: 'ride-xyz', status: 'SEARCHING_DRIVER' });

    const [row] = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.idempotencyKey, key));
    expect(row.status).toBe('COMPLETED');
    expect(row.responseBody).toEqual({ id: 'ride-xyz', status: 'SEARCHING_DRIVER' });
    expect(row.completedAt).not.toBeNull();
  });

  it('a second call with the same key replays the stored response and does not call the handler again', async () => {
    const key = `key-${Date.now()}-replay`;
    const context = makeContext({ 'idempotency-key': key }, { userId });
    let handlerCalls = 0;
    const handler = makeHandler(() => {
      handlerCalls += 1;
      return { id: `ride-call-${handlerCalls}` };
    });

    const first = await lastValueFrom(interceptor.intercept(context, handler));
    const second = await lastValueFrom(interceptor.intercept(context, handler));

    expect(handlerCalls).toBe(1);
    expect(second).toEqual(first);
  });

  it('when the handler throws, the claimed row is deleted (not left IN_PROGRESS, not COMPLETED) and a retry gets a fresh attempt', async () => {
    const key = `key-${Date.now()}-retry-after-failure`;
    const context = makeContext({ 'idempotency-key': key }, { userId });
    const boom = new Error('downstream failure');
    const failingHandler = makeFailingHandler(boom);

    await expect(lastValueFrom(interceptor.intercept(context, failingHandler))).rejects.toBe(boom);

    const rowsAfterFailure = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.idempotencyKey, key));
    expect(rowsAfterFailure).toHaveLength(0);

    // A retry with the same key is now a genuinely fresh attempt, not a cached failure.
    const succeedingHandler = makeHandler(() => ({ id: 'ride-after-retry' }));
    const retryResult = await lastValueFrom(interceptor.intercept(context, succeedingHandler));
    expect(retryResult).toEqual({ id: 'ride-after-retry' });

    const [rowAfterRetry] = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.idempotencyKey, key));
    expect(rowAfterRetry.status).toBe('COMPLETED');
  });

  it('two concurrent requests with the same key: the handler runs at most once; the other gets IN_PROGRESS conflict or the replayed result - never a second independent success', async () => {
    const key = `key-${Date.now()}-concurrent`;
    const contextA = makeContext({ 'idempotency-key': key }, { userId });
    const contextB = makeContext({ 'idempotency-key': key }, { userId });

    let handlerCalls = 0;
    const slowHandler = makeHandler(() => {
      handlerCalls += 1;
      return { id: 'ride-concurrent-winner' };
    });

    const results = await Promise.allSettled([
      lastValueFrom(interceptor.intercept(contextA, slowHandler)),
      lastValueFrom(interceptor.intercept(contextB, slowHandler)),
    ]);

    expect(handlerCalls).toBe(1);

    for (const r of results) {
      if (r.status === 'fulfilled') {
        expect(r.value).toEqual({ id: 'ride-concurrent-winner' });
      } else {
        expect(r.reason).toBeInstanceOf(ConflictException);
        expect((r.reason as ConflictException).getResponse()).toMatchObject({
          code: 'IDEMPOTENCY_KEY_IN_PROGRESS',
        });
      }
    }

    const rows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.idempotencyKey, key));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('COMPLETED');
  });
});
