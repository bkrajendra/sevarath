import { ApiProperty } from '@nestjs/swagger';
import { GeoJsonLineStringDto } from './geojson.dto';

export class CampusRoadResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: GeoJsonLineStringDto }) geometry!: GeoJsonLineStringDto;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
