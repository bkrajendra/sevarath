import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RedisIoAdapter } from './locations/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Wires a SIGTERM/SIGINT signal to actually call app.close() (see docs/open-items.md #19).
  // Nothing else in this file ever calls close() itself - the process only ever stops via a
  // shutdown signal - so without this, every provider's onApplicationShutdown hook (including
  // @nestjs/bullmq's Queue providers closing their underlying ioredis connections, and
  // db/drizzle.module.ts's PgPoolCloser closing the pg Pool) is simply never invoked, and the
  // process would have to be killed outright instead of shutting down gracefully.
  app.enableShutdownHooks();

  // Permissive for now (internal/on-prem system, pre-production) - tighten to an
  // explicit origin allowlist before any public-facing deployment. The WebSocket gateway's
  // own CORS config (location.gateway.ts) mirrors this same posture/caveat.
  app.enableCors({ origin: true, credentials: true });

  // Redis-backed Socket.IO adapter (architecture.md §9.1/§9.2) so WebSocket events fan out
  // correctly across multiple API pods, not just within a single process's in-memory rooms.
  const redisIoAdapter = new RedisIoAdapter(app, app.get(ConfigService));
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  const accessLog = new Logger('HTTP');
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      accessLog.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });

  app.setGlobalPrefix('api', { exclude: ['health', 'health/ready', 'health/live', 'metrics'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('SevaRath API')
    .setDescription('Internal EV booking system - see /docs in the repo for full design docs')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`SevaRath API listening on http://localhost:${port}`);
  console.log(`OpenAPI docs at http://localhost:${port}/api-docs`);
}

bootstrap();
