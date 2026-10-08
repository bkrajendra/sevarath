import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Unit coverage for `HealthController#ready` (docs/open-items.md Phase 9 task: extended to also
 * check Redis, alongside the pre-existing Postgres check). Both dependencies are mocked - this
 * is deliberately NOT an e2e/integration test (no real app boot, no real Postgres/Redis), so it
 * stays fast and fully deterministic about which dependency is "down".
 */
describe('HealthController', () => {
  function makeController(opts: { dbOk: boolean; redisOk: boolean }) {
    const db = {
      execute: opts.dbOk ? jest.fn().mockResolvedValue(undefined) : jest.fn().mockRejectedValue(new Error('db down')),
    };
    const redis = {
      ping: opts.redisOk ? jest.fn().mockResolvedValue('PONG') : jest.fn().mockRejectedValue(new Error('redis down')),
    };
    return { controller: new HealthController(db as any, redis as any), db, redis };
  }

  describe('live() / liveProbe()', () => {
    it('always returns ok and never touches Postgres or Redis', () => {
      const { controller, db, redis } = makeController({ dbOk: false, redisOk: false });

      expect(controller.live()).toEqual({ status: 'ok' });
      expect(controller.liveProbe()).toEqual({ status: 'ok' });
      expect(db.execute).not.toHaveBeenCalled();
      expect(redis.ping).not.toHaveBeenCalled();
    });
  });

  describe('ready()', () => {
    it('returns ok when both Postgres and Redis are reachable', async () => {
      const { controller, db, redis } = makeController({ dbOk: true, redisOk: true });

      await expect(controller.ready()).resolves.toEqual({ status: 'ok' });
      expect(db.execute).toHaveBeenCalledTimes(1);
      expect(redis.ping).toHaveBeenCalledTimes(1);
    });

    it('throws 503 when Postgres is unreachable, without even checking Redis', async () => {
      const { controller, db, redis } = makeController({ dbOk: false, redisOk: true });

      await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(controller.ready()).rejects.toMatchObject({
        message: 'Database is not reachable',
      });
      expect(redis.ping).not.toHaveBeenCalled();
    });

    it('throws 503 when Redis is unreachable, even though Postgres is fine', async () => {
      const { controller, redis, db } = makeController({ dbOk: true, redisOk: false });

      await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(controller.ready()).rejects.toMatchObject({
        message: 'Redis is not reachable',
      });
      expect(db.execute).toHaveBeenCalled();
      expect(redis.ping).toHaveBeenCalled();
    });

    it('throws 503 when both are unreachable (Postgres\'s failure wins, checked first)', async () => {
      const { controller } = makeController({ dbOk: false, redisOk: false });

      await expect(controller.ready()).rejects.toMatchObject({ message: 'Database is not reachable' });
    });
  });
});
