import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CampusRoadsService, type CampusRoadRow } from './campus-roads.service';
import { CreateCampusRoadDto } from './dto/create-campus-road.dto';
import { UpdateActiveDto } from './dto/update-active.dto';
import { CampusRoadResponseDto } from './dto/campus-road-response.dto';

@ApiTags('campus')
@ApiBearerAuth()
@Controller({ path: 'campus/roads', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class CampusRoadsController {
  constructor(private readonly campusRoadsService: CampusRoadsService) {}

  @Post()
  @Roles('ADMIN')
  @ApiCreatedResponse({ type: CampusRoadResponseDto })
  create(@Body() dto: CreateCampusRoadDto): Promise<CampusRoadRow> {
    return this.campusRoadsService.create(dto);
  }

  @Get()
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiOkResponse({ type: [CampusRoadResponseDto] })
  findAll(@Query('includeInactive') includeInactive?: string): Promise<CampusRoadRow[]> {
    return this.campusRoadsService.findAll(includeInactive === 'true');
  }

  @Patch(':id/active')
  @Roles('ADMIN')
  @ApiOkResponse({ type: CampusRoadResponseDto })
  setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateActiveDto,
  ): Promise<CampusRoadRow> {
    return this.campusRoadsService.setActive(id, dto.isActive);
  }
}
