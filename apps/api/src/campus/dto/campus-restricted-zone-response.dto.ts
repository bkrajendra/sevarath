import { ApiProperty } from '@nestjs/swagger';
import { GeoJsonPolygonDto } from './geojson.dto';

export class CampusRestrictedZoneResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) reason!: string | null;
  @ApiProperty({ type: GeoJsonPolygonDto }) geometry!: GeoJsonPolygonDto;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
