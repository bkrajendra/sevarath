import { ApiProperty } from '@nestjs/swagger';

/** specification.md §9 - "Available / busy / offline EV counts" (vehicles side). */
export class VehicleStatusCountsDto {
  @ApiProperty() AVAILABLE!: number;
  @ApiProperty() IN_SERVICE!: number;
  @ApiProperty() MAINTENANCE!: number;
  @ApiProperty() INACTIVE!: number;
}

/** specification.md §9 - "Available / busy / offline EV counts" (driver side, driver_availability enum). */
export class DriverAvailabilityCountsDto {
  @ApiProperty() OFFLINE!: number;
  @ApiProperty() AVAILABLE!: number;
  @ApiProperty() BUSY!: number;
  @ApiProperty() ON_BREAK!: number;
}

export class DashboardSummaryResponseDto {
  @ApiProperty({ type: VehicleStatusCountsDto }) vehiclesByStatus!: VehicleStatusCountsDto;
  @ApiProperty({ type: DriverAvailabilityCountsDto }) driversByAvailability!: DriverAvailabilityCountsDto;
  /** Count of rides not yet in a terminal status (REQUESTED through DRIVER_EN_ROUTE_TO_DESTINATION). */
  @ApiProperty() activeRidesCount!: number;
}
