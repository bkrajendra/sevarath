import { customType } from 'drizzle-orm/pg-core';

/**
 * PostGIS geometry column (SRID 4326). Drizzle has no first-class PostGIS type, so this
 * only declares the column's storage type; reads/writes go through ST_AsGeoJSON /
 * ST_GeomFromGeoJSON helpers in the query layer (see architecture.md §5), not here.
 */
export const geometry = (subtype: 'Point' | 'LineString' | 'Polygon') =>
  customType<{ data: string }>({
    dataType() {
      return `geometry(${subtype},4326)`;
    },
  });
