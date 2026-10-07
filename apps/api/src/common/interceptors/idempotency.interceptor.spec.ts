import { ConflictException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { idempotencyKeys } from '../../db/schema';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/** Mimics drizzle's chainable query builders closely enough to prove the interceptor's actual
 * claim/persist/delete logic - not just that some function was called. Each call records its
 * table/args so assertions can check exactly what was written. */
function makeFakeDb(opts: {
  insertReturning: unknown[];
  selectRows?: unknown[];
}) {
  const calls: {
    insertValues: unknown[];
    insertTarget: unknown;
    selectWhereCalled: boolean;
    updateSet: unknown[];
    updateWhereCalled: boolean;
    deleteWhereCalled: boolean;
  } = {
    insertValues: [],
    insertTarget: undefined,
    selectWhereCalled: false,
    updateSet: [],
    updateWhereCalled: false,
    deleteWhereCalled: false,
  };

  const db = {
    insert: jest.fn((_table: unknown) => ({
      values: jest.fn((values: unknown) => {
        calls.insertValues.push(values);
        return {
          onConflictDoNothing: jest.fn((conflict: unknown) => {
            calls.insertTarget = conflict;
            return {
              returning: jest.fn().mockResolvedValue(opts.insertReturning),
            };
          }),
        };
      }),
    })),
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => {
          calls.selectWhereCalled = true;
          return {
            limit: jest.fn().mockResolvedValue(opts.selectRows ?? []),
          };
        }),
      })),
    })),
    update: jest.fn((_table: unknown) => ({
      set: jest.fn((values: unknown) => {
        calls.updateSet.push(values);
        return {
          where: jest.fn(() => {
            calls.updateWhereCalled = true;
            return Promise.resolve(undefined);
          }),
        };
      }),
    })),
    delete: jest.fn((_table: unknown) => ({
      where: jest.fn(() => {
        calls.deleteWhereCalled = true;
        return Promise.resolve(undefined);
      }),
    })),
  };

  return { db, calls };
}

function makeContext(headers: Record<string, string>, user: { userId: string } | undefined): ExecutionContext {
  const request = { headers, user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getClass: () => ({ name: 'RidesController' }),
    getHandler: () => ({ name: 'create' }),
  } as unknown as ExecutionContext;
}

function makeHandler(result: { value: unknown } | { error: unknown }): CallHandler {
  return {
    handle: jest.fn(() => ('error' in result ? throwError(() => result.error) : of(result.value))),
  };
}

describe('IdempotencyInterceptor', () => {
  it('passes the request through untouched when no Idempotency-Key header is sent', async () => {
    const { db, calls } = makeFakeDb({ insertReturning: [] });
    const interceptor = new IdempotencyInterceptor(db as any);
    const context = makeContext({}, { userId: 'user-1' });
    const handler = makeHandler({ value: { id: 'ride-1' } });

    const result = await lastValueFrom(interceptor.intercept(context, handler));

    expect(result).toEqual({ id: 'ride-1' });
    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
    expect(calls.insertValues).toHaveLength(0);
  });

  it('on a fresh key: claims the row, runs the handler once, and persists a COMPLETED row with the response body', async () => {
    const { db, calls } = makeFakeDb({ insertReturning: [{ id: 'claim-row-1' }] });
    const interceptor = new IdempotencyInterceptor(db as any);
    const context = makeContext({ 'idempotency-key': 'key-abc' }, { userId: 'user-1' });
    const responseBody = { id: 'ride-1', status: 'SEARCHING_DRIVER' };
    const handler = makeHandler({ value: responseBody });

    const result = await lastValueFrom(interceptor.intercept(context, handler));

    expect(result).toEqual(responseBody);
    expect(handler.handle).toHaveBeenCalledTimes(1);

    expect(calls.insertValues).toEqual([
      { userId: 'user-1', route: 'RidesController#create', idempotencyKey: 'key-abc', status: 'IN_PROGRESS' },
    ]);
    expect(calls.insertTarget).toEqual({
      target: [idempotencyKeys.userId, idempotencyKeys.route, idempotencyKeys.idempotencyKey],
    });

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(calls.updateSet[0]).toMatchObject({ status: 'COMPLETED', responseBody });
    expect((calls.updateSet[0] as any).completedAt).toBeInstanceOf(Date);
    expect(calls.updateWhereCalled).toBe(true);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('when the handler throws: deletes the claimed row (not completed, not left IN_PROGRESS) and re-throws the original error', async () => {
    const { db, calls } = makeFakeDb({ insertReturning: [{ id: 'claim-row-1' }] });
    const interceptor = new IdempotencyInterceptor(db as any);
    const context = makeContext({ 'idempotency-key': 'key-abc' }, { userId: 'user-1' });
    const originalError = new Error('boom');
    const handler = makeHandler({ error: originalError });

    await expect(lastValueFrom(interceptor.intercept(context, handler))).rejects.toBe(originalError);

    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(calls.deleteWhereCalled).toBe(true);
  });

  it('when the key already has a COMPLETED row: replays the stored response and never calls the handler', async () => {
    const storedResponse = { id: 'ride-1', status: 'SEARCHING_DRIVER' };
    const { db, calls } = makeFakeDb({
      insertReturning: [],
      selectRows: [
        {
          id: 'existing-row',
          userId: 'user-1',
          route: 'RidesController#create',
          idempotencyKey: 'key-abc',
          status: 'COMPLETED',
          responseBody: storedResponse,
          createdAt: new Date(),
          completedAt: new Date(),
        },
      ],
    });
    const interceptor = new IdempotencyInterceptor(db as any);
    const context = makeContext({ 'idempotency-key': 'key-abc' }, { userId: 'user-1' });
    const handler = makeHandler({ value: { id: 'should-not-be-used' } });

    const result = await lastValueFrom(interceptor.intercept(context, handler));

    expect(result).toEqual(storedResponse);
    expect(handler.handle).not.toHaveBeenCalled();
    expect(calls.selectWhereCalled).toBe(true);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('when the key already has an IN_PROGRESS row: throws ConflictException and never calls the handler', async () => {
    const { db } = makeFakeDb({
      insertReturning: [],
      selectRows: [
        {
          id: 'existing-row',
          userId: 'user-1',
          route: 'RidesController#create',
          idempotencyKey: 'key-abc',
          status: 'IN_PROGRESS',
          responseBody: null,
          createdAt: new Date(),
          completedAt: null,
        },
      ],
    });
    const interceptor = new IdempotencyInterceptor(db as any);
    const context = makeContext({ 'idempotency-key': 'key-abc' }, { userId: 'user-1' });
    const handler = makeHandler({ value: { id: 'should-not-be-used' } });

    await expect(lastValueFrom(interceptor.intercept(context, handler))).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(lastValueFrom(interceptor.intercept(context, handler))).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_IN_PROGRESS' },
    });
    expect(handler.handle).not.toHaveBeenCalled();
  });
});
