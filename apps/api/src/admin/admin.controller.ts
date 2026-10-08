import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { AdminListRidesQueryDto } from './dto/admin-list-rides-query.dto';
import { AdminRidesListResponseDto } from './dto/admin-rides-list-response.dto';
import { DashboardSummaryResponseDto } from './dto/dashboard-summary-response.dto';
import { LiveMapDriverResponseDto } from './dto/live-map-driver-response.dto';

/**
 * Cross-cutting operational views (dashboard, campus-wide rides search, live map) -
 * plan.md Phase 8/specification.md §9. Per-resource CRUD (users/drivers/vehicles) stays on
 * those resources' own controllers, not here - see docs/open-items.md for the reasoning.
 *
 * ADMIN and OPERATOR both get this surface (specification.md §2's "dispatch oversight" role
 * description) - unlike GET /api/v1/users, which is ADMIN-only (users.controller.ts).
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OPERATOR')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard/summary')
  @ApiOkResponse({ type: DashboardSummaryResponseDto })
  getDashboardSummary() {
    return this.adminService.getDashboardSummary();
  }

  @Get('rides')
  @ApiOkResponse({ type: AdminRidesListResponseDto })
  listRides(@Query() query: AdminListRidesQueryDto) {
    return this.adminService.listRides(query);
  }

  @Get('live-map')
  @ApiOkResponse({ type: [LiveMapDriverResponseDto] })
  getLiveMap() {
    return this.adminService.getLiveMap();
  }
}
