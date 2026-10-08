import 'dotenv/config';
import { HealthRedisService } from './health-redis.service';

/**
 * Real-Redis proof that `HealthRedisService` is wired correctly end to end (reads `REDIS_URL`
 * via `ConfigService`, actually opens a connection, actually gets a `PONG` back) against the
 * real local Redis this sandbox runs. Each `ping()` call constructs and fully tears down its
 * own client (see that file's own doc comment), so there is nothing for this suite itself to
 * leak.
 *
 * Deliberately does NOT also exercise a real unreachable-Redis connection failure here, even
 * though that was tried first - see docs/open-items.md for the full account. Summary: a real
 * `ECONNREFUSED` connect attempt, even fully cleaned up (`disconnect()` + explicitly destroying
 * `client.stream`, confirmed to leave zero active handles in a plain Node reproduction outside
 * Jest), reproducibly triggers Jest's "did not exit one second after the test run" warning when
 * run under this project's `ts-jest` setup - isolated down to ioredis's own `connect()` call
 * specifically (a raw `net.createConnection` to the same refused port, cleaned up the same way,
 * does NOT trigger it), not anything this file's own cleanup code does or fails to do. Given
 * this task's own explicit instruction not to reintroduce that warning (docs/open-items.md
 * #19), the failure path is instead proven at the unit level with a mocked
 * `HealthRedisService` (`health.controller.spec.ts`), which exercises the exact same
 * `ready() -> 503` behavior without ever opening a real socket.
 */
describe('HealthRedisService (integration, real Redis)', () => {
  function configFor(redisUrl: string) {
    return { get: (key: string) => (key === 'REDIS_URL' ? redisUrl : undefined) } as any;
  }

  it('ping() resolves against the real local Redis', async () => {
    const service = new HealthRedisService(configFor(process.env.REDIS_URL ?? 'redis://localhost:6380'));
    await expect(service.ping()).resolves.toBeUndefined();
  });
});
