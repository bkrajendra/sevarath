import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/drizzle.module';
import { campusLocations, type CampusLocation, type NewCampusLocation } from '../db/schema';
import type { CreateCampusLocationDto } from './dto/create-campus-location.dto';
import type { UpdateCampusLocationDto } from './dto/update-campus-location.dto';

@Injectable()
export class CampusLocationsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async create(dto: CreateCampusLocationDto): Promise<CampusLocation> {
    const data: NewCampusLocation = {
      name: dto.name,
      type: dto.type,
      latitude: dto.latitude,
      longitude: dto.longitude,
      description: dto.description,
    };
    const [location] = await this.db.insert(campusLocations).values(data).returning();
    return location;
  }

  /** Defaults to active-only (what pickup/destination pickers should show); pass includeInactive for Admin management views. */
  async findAll(includeInactive = false): Promise<CampusLocation[]> {
    if (includeInactive) {
      return this.db.select().from(campusLocations);
    }
    return this.db.select().from(campusLocations).where(eq(campusLocations.isActive, true));
  }

  async findById(id: string): Promise<CampusLocation> {
    const [location] = await this.db
      .select()
      .from(campusLocations)
      .where(eq(campusLocations.id, id));
    if (!location) {
      throw new NotFoundException('Campus location not found');
    }
    return location;
  }

  async update(id: string, dto: UpdateCampusLocationDto): Promise<CampusLocation> {
    await this.findById(id);
    const [location] = await this.db
      .update(campusLocations)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(campusLocations.id, id))
      .returning();
    return location;
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.db.delete(campusLocations).where(eq(campusLocations.id, id));
  }
}
