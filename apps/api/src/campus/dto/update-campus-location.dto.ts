import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsLatitude, IsLongitude, IsOptional, IsString, MinLength } from 'class-validator';

const TYPES = [
  'GATE',
  'BUILDING',
  'OFFICE',
  'RESIDENCE',
  'DINING',
  'PARKING',
  'EV_STOP',
  'MEDICAL',
  'RECEPTION',
  'OTHER',
] as const;

export class UpdateCampusLocationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ enum: TYPES })
  @IsOptional()
  @IsIn(TYPES)
  type?: (typeof TYPES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
