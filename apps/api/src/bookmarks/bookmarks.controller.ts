import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/types/jwt-payload.interface';
import { LocationBookmarksService } from './location-bookmarks.service';
import { LocationBookmarkResponseDto } from './dto/location-bookmark-response.dto';

/** Phase 10.3 (docs/plan.md §5) - favoriting an existing campus_locations entry. */
@ApiTags('bookmarks')
@ApiBearerAuth()
@Controller({ path: 'users/me/bookmarks', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class BookmarksController {
  constructor(private readonly bookmarksService: LocationBookmarksService) {}

  @Get()
  @ApiOkResponse({ type: [LocationBookmarkResponseDto] })
  async findAll(@CurrentUser() currentUser: RequestUser): Promise<LocationBookmarkResponseDto[]> {
    return this.bookmarksService.findForUser(currentUser.userId);
  }

  @Post(':campusLocationId')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse()
  async add(
    @Param('campusLocationId', ParseUUIDPipe) campusLocationId: string,
    @CurrentUser() currentUser: RequestUser,
  ): Promise<void> {
    await this.bookmarksService.add(currentUser.userId, campusLocationId);
  }

  @Delete(':campusLocationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(
    @Param('campusLocationId', ParseUUIDPipe) campusLocationId: string,
    @CurrentUser() currentUser: RequestUser,
  ): Promise<void> {
    await this.bookmarksService.remove(currentUser.userId, campusLocationId);
  }
}
