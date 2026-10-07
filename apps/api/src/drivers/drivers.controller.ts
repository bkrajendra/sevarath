import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/types/jwt-payload.interface';
import { DriversService } from './drivers.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { AssignVehicleDto } from './dto/assign-vehicle.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { DriverResponseDto } from './dto/driver-response.dto';
import type { Driver } from '../db/schema';

@ApiTags('drivers')
@ApiBearerAuth()
@Controller({ path: 'drivers', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Post()
  @Roles('ADMIN')
  @ApiCreatedResponse({ type: DriverResponseDto })
  create(@Body() dto: CreateDriverDto): Promise<Driver> {
    return this.driversService.create(dto);
  }

  @Get()
  @Roles('ADMIN')
  @ApiOkResponse({ type: [DriverResponseDto] })
  findAll(): Promise<Driver[]> {
    return this.driversService.findAll();
  }

  @Get('me')
  @Roles('DRIVER')
  @ApiOkResponse({ type: DriverResponseDto })
  me(@CurrentUser() currentUser: RequestUser): Promise<Driver> {
    return this.driversService.findByUserId(currentUser.userId);
  }

  @Get(':id')
  @Roles('ADMIN')
  @ApiOkResponse({ type: DriverResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Driver> {
    return this.driversService.findById(id);
  }

  @Patch(':id/approve')
  @Roles('ADMIN')
  @ApiOkResponse({ type: DriverResponseDto })
  approve(@Param('id', ParseUUIDPipe) id: string): Promise<Driver> {
    return this.driversService.approve(id);
  }

  @Patch(':id/suspend')
  @Roles('ADMIN')
  @ApiOkResponse({ type: DriverResponseDto })
  suspend(@Param('id', ParseUUIDPipe) id: string): Promise<Driver> {
    return this.driversService.suspend(id);
  }

  @Patch(':id/vehicle')
  @Roles('ADMIN')
  @ApiOkResponse({ type: DriverResponseDto })
  assignVehicle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignVehicleDto,
  ): Promise<Driver> {
    return this.driversService.assignVehicle(id, dto.vehicleId);
  }

  @Post('status')
  @Roles('DRIVER')
  @ApiOkResponse({ type: DriverResponseDto })
  updateStatus(
    @CurrentUser() currentUser: RequestUser,
    @Body() dto: UpdateAvailabilityDto,
  ): Promise<Driver> {
    return this.driversService.updateAvailabilityForUser(currentUser.userId, dto.availability);
  }

  @Post('location')
  @Roles('DRIVER')
  @ApiOkResponse({ type: DriverResponseDto })
  updateLocation(
    @CurrentUser() currentUser: RequestUser,
    @Body() dto: UpdateLocationDto,
  ): Promise<Driver> {
    return this.driversService.updateLocationForUser(currentUser.userId, dto.latitude, dto.longitude);
  }
}
