import { IdempotencyCleanupService } from './idempotency-cleanup.service';

/** Minimal mock of drizzle's chainable `db.delete(...).where(...).returning(...)` call. */
function makeDbMock(returnedRows: Array<{ id: string }>) {
  const returning = jest.fn().mockResolvedValue(returnedRows);
  const where = jest.fn().mockReturnValue({ returning });
  const del = jest.fn().mockReturnValue({ where });
  return { delete: del, where, returning } as const;
}

describe('IdempotencyCleanupService', () => {
  it('deleteExpiredCompleted deletes COMPLETED rows and returns the deleted count', async () => {
    const db = makeDbMock([{ id: 'a' }, { id: 'b' }]);
    const service = new IdempotencyCleanupService(db as any);

    const count = await service.deleteExpiredCompleted();

    expect(count).toBe(2);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('reclaimStuckInProgress deletes IN_PROGRESS rows and returns the deleted count', async () => {
    const db = makeDbMock([{ id: 'c' }]);
    const service = new IdempotencyCleanupService(db as any);

    const count = await service.reclaimStuckInProgress();

    expect(count).toBe(1);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('sweep runs both deletions and logs only when something was actually deleted', async () => {
    const db = makeDbMock([]);
    const service = new IdempotencyCleanupService(db as any);
    const logSpy = jest.spyOn((service as any).logger, 'log');

    await service.sweep();

    expect(db.delete).toHaveBeenCalledTimes(2);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('sweep logs a summary line when rows were deleted', async () => {
    const returning = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'a' }])
      .mockResolvedValueOnce([{ id: 'b' }, { id: 'c' }]);
    const where = jest.fn().mockReturnValue({ returning });
    const del = jest.fn().mockReturnValue({ where });
    const db = { delete: del } as const;
    const service = new IdempotencyCleanupService(db as any);
    const logSpy = jest.spyOn((service as any).logger, 'log');

    await service.sweep();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('deleted 1 expired COMPLETED row(s)'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('reclaimed 2 stuck IN_PROGRESS row(s)'));
  });
});
