import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/drizzle.module';
import { campusRestrictedZones } from '../db/schema';
import type { CreateCampusRestrictedZoneDto } from './dto/create-campus-restricted-zone.dto';
import type { GeoJsonPolygonDto } from './dto/geojson.dto';

export interface CampusRestrictedZoneRow {
  id: string;
  name: string;
  reason: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  geometry: GeoJsonPolygonDto;
}

const SELECT_WITH_GEOJSON = {
  id: campusRestrictedZones.id,
  name: campusRestrictedZones.name,
  reason: campusRestrictedZones.reason,
  isActive: campusRestrictedZones.isActive,
  createdAt: campusRestrictedZones.createdAt,
  updatedAt: campusRestrictedZones.updatedAt,
  geometryJson: sql<string>`ST_AsGeoJSON(${campusRestrictedZones.geom})`,
};

function toRow(
  raw: Omit<CampusRestrictedZoneRow, 'geometry'> & { geometryJson: string },
): CampusRestrictedZoneRow {
  const { geometryJson, ...rest } = raw;
  return { ...rest, geometry: JSON.parse(geometryJson) as GeoJsonPolygonDto };
}

@Injectable()
export class CampusRestrictedZonesService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async create(dto: CreateCampusRestrictedZoneDto): Promise<CampusRestrictedZoneRow> {
    const [row] = await this.db
      .insert(campusRestrictedZones)
      .values({
        name: dto.name,
        reason: dto.reason,
        geom: sql`ST_GeomFromGeoJSON(${JSON.stringify(dto.geometry)})`,
      })
      .returning(SELECT_WITH_GEOJSON);
    return toRow(row);
  }

  /** Active zones are what RoutingProvider passes to Valhalla as exclude_polygons (architecture.md §8.2). */
  async findAll(includeInactive = false): Promise<CampusRestrictedZoneRow[]> {
    const rows = includeInactive
      ? await this.db.select(SELECT_WITH_GEOJSON).from(campusRestrictedZones)
      : await this.db
          .select(SELECT_WITH_GEOJSON)
          .from(campusRestrictedZones)
          .where(eq(campusRestrictedZones.isActive, true));
    return rows.map(toRow);
  }

  async setActive(id: string, isActive: boolean): Promise<CampusRestrictedZoneRow> {
    const [row] = await this.db
      .update(campusRestrictedZones)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(campusRestrictedZones.id, id))
      .returning(SELECT_WITH_GEOJSON);
    if (!row) {
      throw new NotFoundException('Campus restricted zone not found');
    }
    return toRow(row);
  }
}
