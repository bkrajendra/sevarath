import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn } from 'class-validator';

export class GeoJsonLineStringDto {
  @ApiProperty({ enum: ['LineString'] })
  @IsIn(['LineString'])
  type!: 'LineString';

  @ApiProperty({
    description: 'Array of [longitude, latitude] pairs, at least 2 points',
    type: [[Number]],
  })
  @IsArray()
  coordinates!: [number, number][];
}

export class GeoJsonPolygonDto {
  @ApiProperty({ enum: ['Polygon'] })
  @IsIn(['Polygon'])
  type!: 'Polygon';

  @ApiProperty({
    description: 'Array of linear rings; each ring is an array of [longitude, latitude] pairs, first = last point',
    type: [[[Number]]],
  })
  @IsArray()
  coordinates!: [number, number][][];
}
