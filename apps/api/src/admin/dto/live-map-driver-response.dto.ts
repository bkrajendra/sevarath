import { ApiProperty } from '@nestjs/swagger';

/**
 * One driver's data-only "live map" row (specification.md §9's "Live campus map with EV
 * positions", scoped down to data - see docs/open-items.md for why no rendered map/tile layer
 * is in scope here). Only drivers with a non-null current_latitude/current_longitude snapshot
 * are included.
 */
export class LiveMapDriverResponseDto {
  @ApiProperty() driverId!: string;
  @ApiProperty() driverCode!: string;
  @ApiProperty({ enum: ['OFFLINE', 'AVAILABLE', 'BUSY', 'ON_BREAK'] })
  availability!: 'OFFLINE' | 'AVAILABLE' | 'BUSY' | 'ON_BREAK';
  @ApiProperty() latitude!: number;
  @ApiProperty() longitude!: number;
  @ApiProperty({ nullable: true, type: Date }) locationUpdatedAt!: Date | null;
  /** The driver's current non-terminal ride, if any is assigned to them right now. */
  @ApiProperty({ nullable: true, type: String }) activeRideId!: string | null;
  @ApiProperty({ nullable: true, type: String }) activeRideStatus!: string | null;
}
