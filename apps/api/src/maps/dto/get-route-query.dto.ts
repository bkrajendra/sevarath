import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude } from 'class-validator';

export class GetRouteQueryDto {
  @ApiProperty() @Type(() => Number) @IsLatitude() originLat!: number;
  @ApiProperty() @Type(() => Number) @IsLongitude() originLng!: number;
  @ApiProperty() @Type(() => Number) @IsLatitude() destinationLat!: number;
  @ApiProperty() @Type(() => Number) @IsLongitude() destinationLng!: number;
}
