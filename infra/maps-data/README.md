# Campus map data pipeline

Produces the OSM extract that backs both the base map tiles (Martin) and the
routing graph (Valhalla) - see [docs/architecture.md §8.2](../../docs/architecture.md#82-custom-campus-road-network--ev-specific-routing)
and [§9.5](../../docs/architecture.md#95-maps--navigation-layer).

## Current state

`fetch-extract.sh` pulls a real OpenStreetMap extract via the public Overpass
API for a **~10km × 10km bounding box around the public "Abu Road" location**
(`72.73,24.43,72.83,24.53`) - this is a reasonable approximation, not a
precise surveyed campus boundary. It does contain real, verified data for the
actual campus (a "Shantivan dining hall" building is present in the extract).
Refine the bbox once exact campus boundary coordinates are available.

```bash
./fetch-extract.sh
# -> abu-road-extract.osm (gitignored - re-run this script instead of committing it)
```

## Building the Valhalla routing graph

Run as a one-off Kubernetes Job in the cluster (see
[k8s/maps/valhalla-build-job.yaml](../../k8s/maps/valhalla-build-job.yaml)) -
this needs real compute/memory that isn't assumed to be available wherever
this script runs, and keeps the heavy lifting on cluster infrastructure that's
already being managed with kubectl.

The job uses the official `ghcr.io/valhalla/valhalla` image's
`valhalla_build_config` + `valhalla_build_tiles` to turn the OSM extract into
a routing graph under a PVC that the long-running Valhalla service
([k8s/maps/valhalla-deployment.yaml](../../k8s/maps/valhalla-deployment.yaml))
then serves from.

Once `campus_roads` has real data (via the Admin app - see
[docs/architecture.md §8.2](../../docs/architecture.md#82-custom-campus-road-network--ev-specific-routing)),
that data needs merging into the extract (`osmium merge`) before this build
step - not yet automated; tracked as an open item in
[docs/plan.md](../../docs/plan.md).

## Base map tiles (Martin)

Martin can serve tiles two ways, and the current setup uses both:

1. **Live PostGIS layer** - `campus_locations`/`campus_roads` served directly
   from the database, no build step, always current. This is what's actually
   configured in [k8s/maps/martin-deployment.yaml](../../k8s/maps/martin-deployment.yaml)
   right now.
2. **Base map vector tiles** (building footprints, roads, land use from the
   OSM extract) - needs Planetiler (a Java tool) to pre-build an `.mbtiles`
   file, which is **not yet set up** - the OSM extract this script fetches is
   also the input for that step when it's built.
