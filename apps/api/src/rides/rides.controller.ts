import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/types/jwt-payload.interface';
import type { Ride } from '../db/schema';
import { DriversService } from '../drivers/drivers.service';
import { UsersService } from '../users/users.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { RidesService } from './rides.service';
import { CreateRideDto } from './dto/create-ride.dto';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { RideResponseDto, type RideDriverSummaryDto } from './dto/ride-response.dto';

export type RideResponse = Ride & {
  driver: RideDriverSummaryDto | null;
  vehicleCode: string | null;
  vehicleRegistrationNumber: string | null;
};

@ApiTags('rides')
@ApiBearerAuth()
@Controller({ path: 'rides', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class RidesController {
  constructor(
    private readonly ridesService: RidesService,
    private readonly driversService: DriversService,
    private readonly usersService: UsersService,
    private readonly vehiclesService: VehiclesService,
  ) {}

  @Post()
  @Roles('USER')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiCreatedResponse({ type: RideResponseDto })
  async create(
    @CurrentUser() currentUser: RequestUser,
    @Body() dto: CreateRideDto,
  ): Promise<RideResponse> {
    return this.enrich(await this.ridesService.create(currentUser.userId, dto));
  }

  // Registered before GET ':id' - otherwise the UUID param route would swallow '/history'.
  @Get('history')
  @ApiOkResponse({ type: [RideResponseDto] })
  async findHistory(@CurrentUser() currentUser: RequestUser): Promise<RideResponse[]> {
    const rides = await this.ridesService.findHistoryForUser(currentUser.userId);
    return Promise.all(rides.map((ride) => this.enrich(ride)));
  }

  @Get(':id')
  @ApiOkResponse({ type: RideResponseDto })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: RequestUser,
  ): Promise<RideResponse> {
    return this.enrich(await this.ridesService.findById(id, currentUser));
  }

  @Post(':id/cancel')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOkResponse({ type: RideResponseDto })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: RequestUser,
    @Body() dto: CancelRideDto,
  ): Promise<RideResponse> {
    return this.enrich(await this.ridesService.cancel(id, currentUser, dto?.reason));
  }

  @Post(':id/arrived')
  @Roles('DRIVER')
  @ApiOkResponse({ type: RideResponseDto })
  async markArrived(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: RequestUser,
  ): Promise<RideResponse> {
    const driver = await this.driversService.findByUserId(currentUser.userId);
    return this.enrich(await this.ridesService.markArrived(id, driver.id));
  }

  @Post(':id/start')
  @Roles('DRIVER')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOkResponse({ type: RideResponseDto })
  async start(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: RequestUser,
  ): Promise<RideResponse> {
    const driver = await this.driversService.findByUserId(currentUser.userId);
    return this.enrich(await this.ridesService.start(id, driver.id));
  }

  @Post(':id/complete')
  @Roles('DRIVER')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOkResponse({ type: RideResponseDto })
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: RequestUser,
  ): Promise<RideResponse> {
    const driver = await this.driversService.findByUserId(currentUser.userId);
    return this.enrich(await this.ridesService.complete(id, driver.id));
  }

  /**
   * Embeds a lightweight driver/vehicle summary on the response (docs/open-items.md) - the
   * rider has no other authorized way to learn their assigned driver's name/vehicle, since
   * `GET /drivers/:id` is ADMIN-only. Best-effort: a driver/vehicle row that's gone missing
   * (shouldn't normally happen) degrades to `null` rather than failing the whole request.
   */
  private async enrich(ride: Ride): Promise<RideResponse> {
    if (!ride.driverId) {
      return { ...ride, driver: null, vehicleCode: null, vehicleRegistrationNumber: null };
    }

    const [driver, vehicle] = await Promise.all([
      this.driversService.findById(ride.driverId).catch(() => null),
      ride.vehicleId ? this.vehiclesService.findById(ride.vehicleId).catch(() => null) : null,
    ]);
    const user = driver ? await this.usersService.findById(driver.userId).catch(() => undefined) : undefined;

    return {
      ...ride,
      driver: driver && user
        ? { id: driver.id, name: user.name, mobile: user.mobile, driverCode: driver.driverCode }
        : null,
      vehicleCode: vehicle?.vehicleCode ?? null,
      vehicleRegistrationNumber: vehicle?.registrationNumber ?? null,
    };
  }
}
