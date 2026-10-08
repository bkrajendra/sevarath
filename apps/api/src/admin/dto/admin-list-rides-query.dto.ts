import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { rideStatusEnum } from '../../db/schema';

/**
 * Query params for GET /api/v1/admin/rides. Follows the same numeric/enum-coercion convention
 * as maps/dto/get-route-query.dto.ts (`@Type(() => Number)`, relying on the global
 * `ValidationPipe({ transform: true })` set in main.ts).
 */
export class AdminListRidesQueryDto {
  @ApiPropertyOptional({ enum: rideStatusEnum.enumValues })
  @IsOptional()
  @IsIn(rideStatusEnum.enumValues)
  status?: (typeof rideStatusEnum.enumValues)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  driverId?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 - filters rides.requestedAt >= this value' })
  @IsOptional()
  @IsISO8601()
  requestedAfter?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 - filters rides.requestedAt <= this value' })
  @IsOptional()
  @IsISO8601()
  requestedBefore?: string;

  @ApiPropertyOptional({ default: 50, description: 'Clamped to [1, 200].' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}
