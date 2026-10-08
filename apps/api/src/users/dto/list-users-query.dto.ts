import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { userRoleEnum } from '../../db/schema';

/** Query params for GET /api/v1/users (ADMIN-only - see users.controller.ts). */
export class ListUsersQueryDto {
  @ApiPropertyOptional({ enum: userRoleEnum.enumValues })
  @IsOptional()
  @IsIn(userRoleEnum.enumValues)
  role?: (typeof userRoleEnum.enumValues)[number];

  /** Free-text, matched case-insensitively against name/mobile/email. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

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
