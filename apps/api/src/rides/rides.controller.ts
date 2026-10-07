import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/types/jwt-payload.interface';
import type { Ride } from '../db/schema';
import { DriversService } from '../drivers/drivers.service';
import { RidesService } from './rides.service';
import { CreateRideDto } from './dto/create-ride.dto';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { RideResponseDto } from './dto/ride-response.dto';

@ApiTags('rides')
@ApiBearerAuth()
@Controller({ path: 'rides', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class RidesController {
  constructor(
    private readonly ridesService: RidesService,
    private readonly driversService: DriversService,
  ) {}

  @Post()
  @Roles('USER')
  @ApiCreatedResponse({ type: RideResponseDto })
  create(@CurrentUser() currentUser: RequestUser, @Body() dto: CreateRideDto): Promise<Ride> {
    return this.ridesService.create(currentUser.userId, dto);
  }

  // Registered before GET ':id' - otherwise the UUID param route would swallow '/history'.
  @Get('history')
  @ApiOkResponse({ type: [RideResponseDto] })
  findHistory(@CurrentUser() currentUser: RequestUser): Promise<Ride[]> {
    return this.ridesService.findHistoryForUser(currentUser.userId);
  }

  @Get(':id')
  @ApiOkResponse({ type: RideResponseDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: RequestUser,
  ): Promise<Ride> {
    return this.ridesService.findById(id, currentUser);
  }

  @Post(':id/cancel')
  @ApiOkResponse({ type: RideResponseDto })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: RequestUser,
    @Body() dto: CancelRideDto,
  ): Promise<Ride> {
    return this.ridesService.cancel(id, currentUser, dto?.reason);
  }

  @Post(':id/arrived')
  @Roles('DRIVER')
  @ApiOkResponse({ type: RideResponseDto })
  async markArrived(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: RequestUser,
  ): Promise<Ride> {
    const driver = await this.driversService.findByUserId(currentUser.userId);
    return this.ridesService.markArrived(id, driver.id);
  }

  @Post(':id/start')
  @Roles('DRIVER')
  @ApiOkResponse({ type: RideResponseDto })
  async start(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: RequestUser,
  ): Promise<Ride> {
    const driver = await this.driversService.findByUserId(currentUser.userId);
    return this.ridesService.start(id, driver.id);
  }

  @Post(':id/complete')
  @Roles('DRIVER')
  @ApiOkResponse({ type: RideResponseDto })
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: RequestUser,
  ): Promise<Ride> {
    const driver = await this.driversService.findByUserId(currentUser.userId);
    return this.ridesService.complete(id, driver.id);
  }
}
