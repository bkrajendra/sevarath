import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../db/drizzle.module';
import { locationBookmarks, campusLocations, type LocationBookmark } from '../db/schema';
import { CampusLocationsService } from '../campus/campus-locations.service';
import type { LocationBookmarkResponseDto } from './dto/location-bookmark-response.dto';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

@Injectable()
export class LocationBookmarksService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly campusLocationsService: CampusLocationsService,
  ) {}

  async findForUser(userId: string): Promise<LocationBookmarkResponseDto[]> {
    const rows = await this.db
      .select({
        id: locationBookmarks.id,
        campusLocationId: locationBookmarks.campusLocationId,
        createdAt: locationBookmarks.createdAt,
        name: campusLocations.name,
        latitude: campusLocations.latitude,
        longitude: campusLocations.longitude,
      })
      .from(locationBookmarks)
      .innerJoin(campusLocations, eq(locationBookmarks.campusLocationId, campusLocations.id))
      .where(eq(locationBookmarks.userId, userId));
    return rows;
  }

  /** Throws (via `campusLocationsService.findById`) if the location doesn't exist. */
  async add(userId: string, campusLocationId: string): Promise<LocationBookmark> {
    await this.campusLocationsService.findById(campusLocationId);
    try {
      const [row] = await this.db
        .insert(locationBookmarks)
        .values({ userId, campusLocationId })
        .returning();
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('This location is already bookmarked');
      }
      throw error;
    }
  }

  /** Idempotent - removing a bookmark that doesn't exist is a no-op, not an error. */
  async remove(userId: string, campusLocationId: string): Promise<void> {
    await this.db
      .delete(locationBookmarks)
      .where(
        and(eq(locationBookmarks.userId, userId), eq(locationBookmarks.campusLocationId, campusLocationId)),
      );
  }
}
