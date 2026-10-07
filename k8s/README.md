# SevaRath — Kubernetes manifests

On-prem Kubernetes deployment for the `sevarath` namespace: the NestJS API, its
PostGIS-enabled Postgres and Redis, and the Admin static site, fronted by one
Ingress. Mirrors the structure used in other projects' `k8s/` folders (one
`PersistentVolume`/`PersistentVolumeClaim` per app, `hostPath`-backed, so every
stateful workload here is pinned to a single node: `replicas: 1`,
`strategy: Recreate`).

See [docs/architecture.md §9 Infrastructure Topology](../docs/architecture.md#9-infrastructure-topology)
for the design this maps to. The Identity layer is Firebase, a managed
external service with nothing to deploy. The Maps & Navigation layer
(self-hosted Martin tile server + Valhalla routing engine) lives in its own
[k8s/maps/](maps/README.md) - see that README for deploy order and the data
pipeline (real OSM extract → Valhalla graph build).

## Layout

```
k8s/
  api/
    01-namespace.yaml          # the "sevarath" namespace
    02-persistent-volume.yaml  # shared hostPath PV/PVC (subPath per stateful service)
    03-deployment.yaml         # sevarath-api (NestJS)
    04-service.yaml
    05-postgres-deployment.yaml  # postgis/postgis:16-3.4
    06-postgres-service.yaml
    07-redis-deployment.yaml     # AOF persistence, for BullMQ durability
    08-redis-service.yaml
    09-migration-job.yaml        # one-off Job that applies pending Drizzle migrations
    examples/                    # secret templates - never apply these directly
  admin/
    01-deployment.yaml         # sevarath-admin (static Vite build behind nginx)
    02-service.yaml
  maps/                        # Martin + Valhalla - see maps/README.md
  ingress.yaml                 # routes /api + /health -> api, / -> admin
```

## Deploy order

```bash
kubectl apply -f k8s/api/01-namespace.yaml
kubectl apply -f k8s/api/02-persistent-volume.yaml

# Postgres - real secret, not the .example.yaml file
kubectl -n sevarath create secret generic sevarath-postgres-env \
  --from-literal=POSTGRES_USER=sevarath \
  --from-literal=POSTGRES_DB=sevarath \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -base64 32)"
kubectl apply -f k8s/api/05-postgres-deployment.yaml -f k8s/api/06-postgres-service.yaml

kubectl apply -f k8s/api/07-redis-deployment.yaml -f k8s/api/08-redis-service.yaml

# API - put the real postgres password from above into DATABASE_URL, plus the
# Firebase service account from apps/api/.env (see docs/architecture.md §9.4)
kubectl -n sevarath create secret generic sevarath-api-env --from-env-file=apps/api/.env
kubectl apply -f k8s/api/03-deployment.yaml -f k8s/api/04-service.yaml

kubectl apply -f k8s/admin/

kubectl apply -f k8s/ingress.yaml  # edit the REPLACE_ME host first
```

The `examples/*.example.yaml` files are references only — create the real
Secrets with `kubectl create secret` as shown above rather than committing
filled-in values.

## Database migrations

Migrations are **not** baked into the API image or run automatically on pod
start. They also don't need to be - `apps/api/src/db/migrate.ts` uses
drizzle-orm's own programmatic migrator (`drizzle-orm/node-postgres/migrator`),
not the `drizzle-kit` CLI, so it has no devDependency on `drizzle-kit`/`tsx`
and gets compiled into the normal production build at
`dist/src/db/migrate.js` by `nest build` - it can run with plain `node`
from the exact image already deployed. `k8s/api/09-migration-job.yaml` runs
it as a one-off Job against the cluster's own Postgres, using the same
`DATABASE_URL` secret key the API deployment already has:

```bash
kubectl -n sevarath delete job sevarath-api-db-migration --ignore-not-found
kubectl apply -f k8s/api/09-migration-job.yaml
kubectl -n sevarath wait --for=condition=complete job/sevarath-api-db-migration --timeout=120s
kubectl -n sevarath logs job/sevarath-api-db-migration
```

Run this after every deploy that adds new migration files (Drizzle's
migration journal only applies ones it hasn't recorded yet, so it's safe to
re-run even when there's nothing new). `imagePullPolicy: Always` plus
deleting the Job before re-applying ensures it always runs against the
current `:latest` image rather than a stale completed-Job result Kubernetes
would otherwise reuse.

**Fallback**, if you need to run a migration from a machine with the full
`apps/api` devDependencies installed instead:

```bash
kubectl -n sevarath port-forward svc/sevarath-postgres 5433:5432
DATABASE_URL="postgresql://sevarath:<password>@localhost:5433/sevarath" \
  pnpm --filter @sevarath/api db:migrate
```

## Images

Both images are built and pushed to `ghcr.io/bkrajendra/sevarath-{api,admin}`
by [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml)
on every push (`:latest` on `main`, `:<branch-name>` otherwise). Adjust the
`image:` fields in `api/03-deployment.yaml` / `admin/01-deployment.yaml` and
the workflow's registry path if the repository lives under a different owner.

The Admin image bakes in `VITE_FIREBASE_*`/`VITE_API_BASE_URL` at **build**
time (they're the Firebase Web SDK's public config, not secrets - see
`apps/admin/Dockerfile`). To point a deployed Admin build at different
Firebase/API settings, rebuild the image with different `--build-arg` values
rather than trying to override them at container runtime.

## Accessing services

All are `ClusterIP`, reachable from any namespace at
`<service>.sevarath.svc.cluster.local`:

- API: `sevarath-api.sevarath.svc.cluster.local:3000`
- Postgres: `sevarath-postgres.sevarath.svc.cluster.local:5432`
- Redis: `sevarath-redis.sevarath.svc.cluster.local:6379`
- Admin: `sevarath-admin.sevarath.svc.cluster.local:80`

To connect from your laptop: `kubectl -n sevarath port-forward svc/sevarath-postgres 5433:5432`
(same pattern for any of the others).
