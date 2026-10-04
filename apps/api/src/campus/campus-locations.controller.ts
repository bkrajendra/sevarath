import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CampusLocationsService } from './campus-locations.service';
import { CreateCampusLocationDto } from './dto/create-campus-location.dto';
import { UpdateCampusLocationDto } from './dto/update-campus-location.dto';
import { CampusLocationResponseDto } from './dto/campus-location-response.dto';
import type { CampusLocation } from '../db/schema';

@ApiTags('campus')
@ApiBearerAuth()
@Controller({ path: 'campus/locations', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class CampusLocationsController {
  constructor(private readonly campusLocationsService: CampusLocationsService) {}

  @Post()
  @Roles('ADMIN')
  @ApiCreatedResponse({ type: CampusLocationResponseDto })
  create(@Body() dto: CreateCampusLocationDto): Promise<CampusLocation> {
    return this.campusLocationsService.create(dto);
  }

  @Get()
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiOkResponse({ type: [CampusLocationResponseDto] })
  findAll(@Query('includeInactive') includeInactive?: string): Promise<CampusLocation[]> {
    return this.campusLocationsService.findAll(includeInactive === 'true');
  }

  @Get(':id')
  @ApiOkResponse({ type: CampusLocationResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<CampusLocation> {
    return this.campusLocationsService.findById(id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @ApiOkResponse({ type: CampusLocationResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampusLocationDto,
  ): Promise<CampusLocation> {
    return this.campusLocationsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.campusLocationsService.remove(id);
  }
}
