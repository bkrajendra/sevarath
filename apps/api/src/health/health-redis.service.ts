import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

/**
 * Minimal Redis reachability check for `GET /health/ready` (docs/open-items.md Phase 9 task -
 * this controller previously checked Postgres only).
 *
 * Deliberately a fresh, one-shot `ioredis` connection per `ping()` call, not one shared
 * long-lived client reused across every readiness probe - and not a reuse of
 * `LocationCacheService`'s client either (that one lives in `LocationsModule`, isn't exported
 * for this purpose, and is itself long-lived). A persistent client was tried first and hit a
 * real, reproduced bug worth recording: with `lazyConnect: true` + `enableOfflineQueue: false`
 * (needed to fail fast instead of hanging), ioredis rejects a command immediately with "Stream
 * isn't writeable" rather than ever triggering the implicit lazy-connect - so `ping()` never
 * even attempted a connection, let alone observed a real outage. Reconnect-retry state surviving
 * between calls (to "self-heal" once Redis comes back) also meant deciding when a persistent
 * client should re-attempt vs. give up, non-trivial to get right. A fresh client per call sidesteps
 * all of that: explicitly `connect()`, `ping()`, always `disconnect()` in a `finally` - a clean,
 * independent probe every time, with no state to leak between readiness checks (the construction
 * overhead is irrelevant at readiness-probe frequency, not a hot path).
 *
 * Parses `REDIS_URL` the same way every other Redis client in this codebase already does
 * (`location-cache.service.ts`, `redis-io.adapter.ts`, `app.module.ts`'s `BullModule` factory) -
 * no second way to read Redis connection info was invented.
 *
 * `connectTimeout`/`commandTimeout` (1500ms each) bound a merely-slow (not fully down) Redis;
 * `retryStrategy: () => null` disables ioredis's own internal reconnect-retry entirely - this
 * client is single-use, so there is nothing later to retry for. `disconnect()` (not `quit()`) in
 * the `finally` unconditionally tears the connection down without sending a command, so it can
 * never itself reject/hang regardless of whether `connect()`/`ping()` succeeded. `client.stream`
 * (ioredis's own underlying `net.Socket`/`tls.TLSSocket`, documented `@ignore` i.e. "internal,
 * don't build on this lightly" rather than truly private) is explicitly `destroy()`ed too, as a
 * belt-and-suspenders measure confirmed (via `process._getActiveHandles()` in a standalone
 * Node script) to leave zero open handles after a failed connect - see docs/open-items.md for
 * the full account of why the automated test suite still doesn't exercise a real connection
 * failure against this method despite that confirmation (a Jest/ts-jest-specific timing quirk,
 * isolated to ioredis's own `connect()`, not anything this cleanup does or fails to do).
 */
@Injectable()
export class HealthRedisService {
  private readonly logger = new Logger(HealthRedisService.name);

  constructor(private readonly config: ConfigService) {}

  /** Resolves if Redis answers PING, rejects otherwise (down, unreachable, or timed out). */
  async ping(): Promise<void> {
    const redisUrl = new URL(this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379');
    const client = new Redis({
      host: redisUrl.hostname,
      port: Number(redisUrl.port) || 6379,
      lazyConnect: true,
      connectTimeout: 1500,
      commandTimeout: 1500,
      retryStrategy: () => null,
    });
    // Without a listener, ioredis's 'error' event would crash the process (Node's default
    // behavior for an unhandled 'error' event) - the actual failure is already surfaced via the
    // rejected connect()/ping() promise below, so this is a deliberate no-op, just logged.
    client.on('error', (error) => {
      this.logger.debug(`Health-check Redis client error (expected during an outage): ${error.message}`);
    });

    try {
      await client.connect();
      await client.ping();
    } finally {
      client.disconnect();
      // See class doc comment - disconnect() alone left a real open socket handle after a
      // failed connect() in testing. destroy() is a no-op if the stream is already gone/absent.
      client.stream?.destroy();
    }
  }
}
