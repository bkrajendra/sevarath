import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO adapter backed by Redis pub/sub (architecture.md §9.1/§9.2), so WebSocket events
 * fan out correctly across multiple API pods - each pod only holds a subset of connections,
 * and without this adapter `server.to(room).emit(...)` would only reach sockets connected to
 * the *same* pod that called it.
 *
 * Reuses the same `REDIS_URL`-parsing approach as `app.module.ts`'s `BullModule.forRootAsync`
 * (host/port parsed from the URL) rather than inventing a second way to read Redis connection
 * info. Two separate `ioredis` clients are required by `@socket.io/redis-adapter` itself - one
 * dedicated to publishing, one dedicated to subscribing - since a client in Redis subscribe
 * mode cannot also issue ordinary commands.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(
    app: INestApplicationContext,
    private readonly config: ConfigService,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const redisUrl = new URL(this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379');
    const connectionOptions = { host: redisUrl.hostname, port: Number(redisUrl.port) || 6379 };

    this.pubClient = new Redis(connectionOptions);
    this.subClient = this.pubClient.duplicate();

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        this.pubClient!.once('ready', resolve);
        this.pubClient!.once('error', reject);
      }),
      new Promise<void>((resolve, reject) => {
        this.subClient!.once('ready', resolve);
        this.subClient!.once('error', reject);
      }),
    ]);

    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, options);
    if (!this.adapterConstructor) {
      throw new Error('RedisIoAdapter.connectToRedis() must be awaited before createIOServer()');
    }
    server.adapter(this.adapterConstructor);
    return server;
  }

  async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.all([this.pubClient?.quit(), this.subClient?.quit()]);
  }
}
