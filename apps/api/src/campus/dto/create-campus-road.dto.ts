import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, MinLength, ValidateNested } from 'class-validator';
import { GeoJsonLineStringDto } from './geojson.dto';

export class CreateCampusRoadDto {
  @ApiProperty({ example: 'Service road behind Dining Hall' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ type: GeoJsonLineStringDto })
  @ValidateNested()
  @Type(() => GeoJsonLineStringDto)
  geometry!: GeoJsonLineStringDto;
}
