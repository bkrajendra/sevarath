import { Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { eq, and, desc } from 'drizzle-orm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/types/jwt-payload.interface';
import type { Ride } from '../db/schema';
import { DRIZZLE, type DrizzleDb } from '../db/drizzle.module';
import { rideOffers, rides } from '../db/schema';
import { DriversService } from '../drivers/drivers.service';
import { AssignmentService } from './assignment.service';

/**
 * Driver-facing accept/reject endpoints, sharing the 'rides' base path with RidesController
 * (no :accept/:reject route there, so no collision).
 */
@ApiTags('rides')
@ApiBearerAuth()
@Controller({ path: 'rides', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class DispatchController {
  constructor(
    private readonly driversService: DriversService,
    private readonly assignmentService: AssignmentService,
  ) {}

  @Post(':id/accept')
  @Roles('DRIVER')
  @ApiOkResponse()
  async accept(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: RequestUser,
  ): Promise<Ride> {
    const driver = await this.driversService.findByUserId(currentUser.userId);
    return this.assignmentService.accept(id, driver.id);
  }

  @Post(':id/reject')
  @Roles('DRIVER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: RequestUser,
  ): Promise<void> {
    const driver = await this.driversService.findByUserId(currentUser.userId);
    await this.assignmentService.reject(id, driver.id);
  }
}

export interface PendingOfferResponse {
  offerId: string;
  rideId: string;
  offeredAt: Date;
  pickup: { latitude: number; longitude: number; locationName: string | null };
  destination: { latitude: number; longitude: number; locationName: string | null };
}

/**
 * Driver's own pending-offer discovery endpoint. There is no WebSocket gateway yet (Phase 5),
 * so polling this is the driver app's only way today to learn it has a new ride offer - see the
 * same caveat at dispatch.service.ts#offerToDriver.
 */
@ApiTags('dispatch')
@ApiBearerAuth()
@Controller({ path: 'dispatch', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class DispatchOffersController {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly driversService: DriversService,
  ) {}

  @Get('offers/me')
  @Roles('DRIVER')
  @ApiOkResponse()
  async myPendingOffer(
    @CurrentUser() currentUser: RequestUser,
  ): Promise<PendingOfferResponse | null> {
    const driver = await this.driversService.findByUserId(currentUser.userId);

    const [row] = await this.db
      .select({ offer: rideOffers, ride: rides })
      .from(rideOffers)
      .innerJoin(rides, eq(rides.id, rideOffers.rideId))
      .where(and(eq(rideOffers.driverId, driver.id), eq(rideOffers.result, 'PENDING')))
      .orderBy(desc(rideOffers.offeredAt))
      .limit(1);

    if (!row) {
      return null;
    }

    return {
      offerId: row.offer.id,
      rideId: row.ride.id,
      offeredAt: row.offer.offeredAt,
      pickup: {
        latitude: row.ride.pickupLatitude,
        longitude: row.ride.pickupLongitude,
        locationName: row.ride.pickupLocationName,
      },
      destination: {
        latitude: row.ride.destinationLatitude,
        longitude: row.ride.destinationLongitude,
        locationName: row.ride.destinationLocationName,
      },
    };
  }
}
