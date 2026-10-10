import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateDriverDto {
  @ApiPropertyOptional({ example: 'DRV-001' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  driverCode?: string;
}
