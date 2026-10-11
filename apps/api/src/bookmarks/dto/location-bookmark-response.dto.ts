import { ApiProperty } from '@nestjs/swagger';

/**
 * A favorited `campus_locations` entry, with enough of that location's own fields inlined that a
 * picker UI can render it without a second lookup (docs/plan.md §5/10.3).
 */
export class LocationBookmarkResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() campusLocationId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() latitude!: number;
  @ApiProperty() longitude!: number;
  @ApiProperty() createdAt!: Date;
}
