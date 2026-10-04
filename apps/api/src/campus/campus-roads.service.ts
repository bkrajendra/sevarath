import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/drizzle.module';
import { campusRoads } from '../db/schema';
import type { CreateCampusRoadDto } from './dto/create-campus-road.dto';
import type { GeoJsonLineStringDto } from './dto/geojson.dto';

export interface CampusRoadRow {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  geometry: GeoJsonLineStringDto;
}

const SELECT_WITH_GEOJSON = {
  id: campusRoads.id,
  name: campusRoads.name,
  isActive: campusRoads.isActive,
  createdAt: campusRoads.createdAt,
  updatedAt: campusRoads.updatedAt,
  geometryJson: sql<string>`ST_AsGeoJSON(${campusRoads.geom})`,
};

function toRow(raw: Omit<CampusRoadRow, 'geometry'> & { geometryJson: string }): CampusRoadRow {
  const { geometryJson, ...rest } = raw;
  return { ...rest, geometry: JSON.parse(geometryJson) as GeoJsonLineStringDto };
}

@Injectable()
export class CampusRoadsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async create(dto: CreateCampusRoadDto): Promise<CampusRoadRow> {
    const [row] = await this.db
      .insert(campusRoads)
      .values({
        name: dto.name,
        geom: sql`ST_GeomFromGeoJSON(${JSON.stringify(dto.geometry)})`,
      })
      .returning(SELECT_WITH_GEOJSON);
    return toRow(row);
  }

  async findAll(includeInactive = false): Promise<CampusRoadRow[]> {
    const rows = includeInactive
      ? await this.db.select(SELECT_WITH_GEOJSON).from(campusRoads)
      : await this.db
          .select(SELECT_WITH_GEOJSON)
          .from(campusRoads)
          .where(eq(campusRoads.isActive, true));
    return rows.map(toRow);
  }

  async setActive(id: string, isActive: boolean): Promise<CampusRoadRow> {
    const [row] = await this.db
      .update(campusRoads)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(campusRoads.id, id))
      .returning(SELECT_WITH_GEOJSON);
    if (!row) {
      throw new NotFoundException('Campus road not found');
    }
    return toRow(row);
  }
}
