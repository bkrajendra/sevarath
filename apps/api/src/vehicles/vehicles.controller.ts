import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleStatusDto } from './dto/update-vehicle-status.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehicleResponseDto } from './dto/vehicle-response.dto';
import type { Vehicle } from '../db/schema';

@ApiTags('vehicles')
@ApiBearerAuth()
@Controller({ path: 'vehicles', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Post()
  @Roles('ADMIN')
  @ApiCreatedResponse({ type: VehicleResponseDto })
  create(@Body() dto: CreateVehicleDto): Promise<Vehicle> {
    return this.vehiclesService.create(dto);
  }

  @Get()
  @ApiOkResponse({ type: [VehicleResponseDto] })
  findAll(): Promise<Vehicle[]> {
    return this.vehiclesService.findAll();
  }

  @Get(':id')
  @ApiOkResponse({ type: VehicleResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Vehicle> {
    return this.vehiclesService.findById(id);
  }

  /** Admin-only edit: vehicleCode/registrationNumber/vehicleType/capacity - status stays on its own endpoint below. */
  @Patch(':id')
  @Roles('ADMIN')
  @ApiOkResponse({ type: VehicleResponseDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVehicleDto): Promise<Vehicle> {
    return this.vehiclesService.update(id, dto);
  }

  @Patch(':id/status')
  @Roles('ADMIN')
  @ApiOkResponse({ type: VehicleResponseDto })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleStatusDto,
  ): Promise<Vehicle> {
    return this.vehiclesService.updateStatus(id, dto.status);
  }
}
