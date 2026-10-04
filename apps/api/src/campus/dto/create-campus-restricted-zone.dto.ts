import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { GeoJsonPolygonDto } from './geojson.dto';

export class CreateCampusRestrictedZoneDto {
  @ApiProperty({ example: 'Dining plaza - event closure' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({ type: GeoJsonPolygonDto })
  @ValidateNested()
  @Type(() => GeoJsonPolygonDto)
  geometry!: GeoJsonPolygonDto;
}
