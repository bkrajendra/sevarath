import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['USER', 'DRIVER', 'ADMIN', 'OPERATOR']);

export const userStatusEnum = pgEnum('user_status', ['ACTIVE', 'SUSPENDED', 'PENDING']);

export const driverStatusEnum = pgEnum('driver_status', [
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'INACTIVE',
]);

export const driverAvailabilityEnum = pgEnum('driver_availability', [
  'OFFLINE',
  'AVAILABLE',
  'BUSY',
  'ON_BREAK',
]);

export const vehicleStatusEnum = pgEnum('vehicle_status', [
  'AVAILABLE',
  'IN_SERVICE',
  'MAINTENANCE',
  'INACTIVE',
]);

export const rideStatusEnum = pgEnum('ride_status', [
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
]);

export const rideOfferResultEnum = pgEnum('ride_offer_result', [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
]);

export const campusLocationTypeEnum = pgEnum('campus_location_type', [
  'GATE',
  'BUILDING',
  'OFFICE',
  'RESIDENCE',
  'DINING',
  'PARKING',
  'EV_STOP',
  'MEDICAL',
  'RECEPTION',
  'OTHER',
]);
