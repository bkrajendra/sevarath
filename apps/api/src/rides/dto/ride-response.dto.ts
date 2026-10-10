import { ApiProperty } from '@nestjs/swagger';

const RIDE_STATUS_VALUES = [
  'REQUESTED',
  'SEARCHING_DRIVER',
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE_TO_PICKUP',
  'DRIVER_ARRIVED',
  'RIDE_STARTED',
  'DRIVER_EN_ROUTE_TO_DESTINATION',
  'COMPLETED',
  'CANCELLED_BY_USER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_SYSTEM',
  'NO_DRIVER_AVAILABLE',
] as const;

/**
 * Lightweight driver summary embedded on an assigned ride, so a rider client can show who's
 * coming without a separate call - `GET /drivers/:id` is ADMIN-only (drivers.controller.ts),
 * so there is no other authorized way for a rider to learn their own assigned driver's name.
 */
export class RideDriverSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() mobile!: string;
  @ApiProperty() driverCode!: string;
}

export class RideResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty({ nullable: true, type: String }) driverId!: string | null;
  @ApiProperty({ nullable: true, type: String }) vehicleId!: string | null;
  @ApiProperty({ nullable: true, type: RideDriverSummaryDto }) driver!: RideDriverSummaryDto | null;
  @ApiProperty({ nullable: true, type: String }) vehicleCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) vehicleRegistrationNumber!: string | null;

  @ApiProperty() pickupLatitude!: number;
  @ApiProperty() pickupLongitude!: number;
  @ApiProperty({ nullable: true, type: String }) pickupLocationName!: string | null;

  @ApiProperty() destinationLatitude!: number;
  @ApiProperty() destinationLongitude!: number;
  @ApiProperty({ nullable: true, type: String }) destinationLocationName!: string | null;

  @ApiProperty({ enum: RIDE_STATUS_VALUES })
  status!: (typeof RIDE_STATUS_VALUES)[number];

  @ApiProperty() requestedAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) acceptedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) driverArrivedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) startedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) completedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) cancelledAt!: Date | null;

  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
