import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CampusRestrictedZonesService,
  type CampusRestrictedZoneRow,
} from './campus-restricted-zones.service';
import { CreateCampusRestrictedZoneDto } from './dto/create-campus-restricted-zone.dto';
import { UpdateActiveDto } from './dto/update-active.dto';
import { CampusRestrictedZoneResponseDto } from './dto/campus-restricted-zone-response.dto';

@ApiTags('campus')
@ApiBearerAuth()
@Controller({ path: 'campus/restricted-zones', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class CampusRestrictedZonesController {
  constructor(private readonly campusRestrictedZonesService: CampusRestrictedZonesService) {}

  @Post()
  @Roles('ADMIN')
  @ApiCreatedResponse({ type: CampusRestrictedZoneResponseDto })
  create(@Body() dto: CreateCampusRestrictedZoneDto): Promise<CampusRestrictedZoneRow> {
    return this.campusRestrictedZonesService.create(dto);
  }

  @Get()
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiOkResponse({ type: [CampusRestrictedZoneResponseDto] })
  findAll(@Query('includeInactive') includeInactive?: string): Promise<CampusRestrictedZoneRow[]> {
    return this.campusRestrictedZonesService.findAll(includeInactive === 'true');
  }

  @Patch(':id/active')
  @Roles('ADMIN')
  @ApiOkResponse({ type: CampusRestrictedZoneResponseDto })
  setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateActiveDto,
  ): Promise<CampusRestrictedZoneRow> {
    return this.campusRestrictedZonesService.setActive(id, dto.isActive);
  }
}
