import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsLatitude, IsLongitude, IsOptional, IsString, MinLength } from 'class-validator';

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

export class CreateCampusLocationDto {
  @ApiProperty({ example: 'Main Gate' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ enum: TYPES })
  @IsIn(TYPES)
  type!: (typeof TYPES)[number];

  @ApiProperty()
  @IsLatitude()
  latitude!: number;

  @ApiProperty()
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
