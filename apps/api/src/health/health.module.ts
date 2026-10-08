import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthRedisService } from './health-redis.service';

@Module({
  controllers: [HealthController],
  providers: [HealthRedisService],
})
export class HealthModule {}
