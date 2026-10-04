# SevaRath — Maps & Navigation infra

Self-hosted, open-source tile server (Martin) and routing engine (Valhalla) -
see [docs/architecture.md §8](../../docs/architecture.md#8-maps--navigation)
and [§9.5](../../docs/architecture.md#95-maps--navigation-layer).

## Deploy order

```bash
kubectl apply -f k8s/maps/01-persistent-volume.yaml

# Martin - serves campus_roads/campus_restricted_zones live from PostGIS, no
# build step needed.
kubectl -n sevarath create secret generic sevarath-martin-env \
  --from-literal=DATABASE_URL="postgresql://sevarath:<password>@sevarath-postgres.sevarath.svc.cluster.local:5432/sevarath"
kubectl apply -f k8s/maps/06-martin-deployment.yaml -f k8s/maps/07-martin-service.yaml

# Valhalla - needs a graph build first. See infra/maps-data/README.md for
# where the OSM extract comes from.
kubectl apply -f k8s/maps/02-data-loader-pod.yaml
kubectl -n sevarath wait --for=condition=Ready pod/sevarath-maps-data-loader
kubectl -n sevarath cp infra/maps-data/abu-road-extract.osm \
  sevarath-maps-data-loader:/data/raw/abu-road-extract.osm
kubectl delete -f k8s/maps/02-data-loader-pod.yaml

kubectl apply -f k8s/maps/03-valhalla-build-job.yaml
kubectl -n sevarath wait --for=condition=complete job/sevarath-valhalla-build --timeout=20m
kubectl apply -f k8s/maps/04-valhalla-deployment.yaml -f k8s/maps/05-valhalla-service.yaml
```

## Rebuilding the graph

```bash
kubectl -n sevarath delete job/sevarath-valhalla-build
# repeat the data-loader steps above if the extract changed
kubectl apply -f k8s/maps/03-valhalla-build-job.yaml
kubectl -n sevarath wait --for=condition=complete job/sevarath-valhalla-build --timeout=20m
kubectl -n sevarath rollout restart deployment/sevarath-valhalla
```

This is the manual version of the "Admin-triggered rebuild job" described in
[docs/architecture.md §8.2](../../docs/architecture.md#82-custom-campus-road-network--ev-specific-routing) -
a real Admin-app button that runs this is a follow-up, not built yet.

## Accessing

- Valhalla: `sevarath-valhalla.sevarath.svc.cluster.local:8002` (route API -
  see [architecture.md §8](../../docs/architecture.md#8-maps--navigation)).
  Called from the backend's `maps/` module only, never directly from a client.
- Martin: `sevarath-martin.sevarath.svc.cluster.local:3000` - tiles at
  `/campus_roads/{z}/{x}/{y}` and `/campus_restricted_zones/{z}/{x}/{y}`
  once it has discovered those tables. Served directly to clients (no API
  proxy, it's static-asset-style traffic).
