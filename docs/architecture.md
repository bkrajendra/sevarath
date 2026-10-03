# SevaRath - Architecture & Technical Design

> Back to [README](../README.md) · See also [Specification](./specification.md) · [Frontend Guidelines](./frontend-guidelines.md) · [Implementation Plan](./plan.md)

## 1. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Backend | **NestJS** (TypeScript) | Modular monolith - DI, decorators, clean module boundaries |
| ORM / DB access | **Drizzle ORM** | TypeScript-first, SQL-like, migration-friendly |
| Database | **PostgreSQL** (+ PostGIS) | Source of truth; PostGIS for geospatial queries |
| Cache / real-time state | **Redis** | Presence, live location, dispatch locks, BullMQ queues |
| Background jobs / queue | **BullMQ** (on Redis) | Automated release actions, timeouts, async notification delivery |
| Admin frontend | **React + Tailwind CSS + shadcn/ui + Base Web (baseui)** | See [frontend-guidelines.md](./frontend-guidelines.md) |
| User / Driver apps | **Flutter** | Cross-platform mobile (iOS/Android); shares domain contracts via generated OpenAPI client, not source code with the TS stack |
| Map rendering | **MapLibre GL Native** (`maplibre_gl` Flutter plugin) | Open-source, vendor-neutral map SDK — see [makewithmaplibre.com](https://makewithmaplibre.com/sdks/flutter-maplibre-gl-official/); §8 |
| Map tiles | **Self-hosted vector tiles** — OpenMapTiles/Planetiler extract + Martin or TileServer GL | No commercial tile API dependency; §8, §9.5 |
| Routing & turn-by-turn | **Valhalla** (self-hosted) | Open-source routing engine with built-in maneuver narrative, used for route + turn-by-turn instructions; §8, §9.5 |
| API style | **REST, OpenAPI 3.1, versioned** | `/api/v1/...`; see §6 |
| Real-time transport | **WebSocket** (NestJS Gateway) | Ride/location/presence events |
| Identity | **Passport.js** strategies under NestJS | Google OAuth (SSO) for Admin/staff, Mobile OTP for User/Driver |
| Deployment | **Docker** containers on **on-prem Kubernetes** | See §9 Infrastructure Topology |

This supersedes the React Native recommendation in the original architecture notes: **Admin is a React web app; User and Driver are Flutter mobile apps.** Because Flutter and the TS/React stack can't share source code, all cross-stack contracts (DTOs, enums, ride states) are enforced through the **OpenAPI spec**, not shared packages - see §6.

## 2. System Architecture

```text
                         +----------------------+        +----------------------+
                         |   Flutter Apps       |        |   Admin (React)      |
                         |  User App / Driver   |        |  Tailwind + shadcn/ui|
                         |  App                 |        |  + baseui            |
                         +----------+-----------+        +----------+-----------+
                                    |                                |
                              HTTPS / WSS                      HTTPS / WSS
                                    |                                |
                                    +----------------+---------------+
                                                     |
                                                     v
                                       +----------------------------+
                                       |   Reverse Proxy / Gateway  |
                                       +-------------+--------------+
                                                     |
                                                     v
                                       +----------------------------+
                                       |        NestJS API           |
                                       |  (OpenAPI v1, versioned)    |
                                       |----------------------------|
                                       | Auth  | Users   | Drivers  |
                                       | Vehicles | Rides | Dispatch|
                                       | Locations | Notifications |
                                       | Maps  | Campus  | Admin   |
                                       +------+--------------+------+
                                              |              |
                                   +----------+              +----------+
                                   v                                    v
                        +--------------------+                +-------------------+
                        | PostgreSQL + PostGIS|               |       Redis       |
                        | (Drizzle ORM)       |               | presence, cache,  |
                        | business truth       |               | BullMQ queues     |
                        +--------------------+                +-------------------+
                                                     |
                                                     v
                                       +----------------------------+
                                       | Tile Server  |  Valhalla   |
                                       | (Martin/     |  (routing + |
                                       |  TileServer  |  turn-by-   |
                                       |  GL)         |  turn)      |
                                       +----------------------------+
```

## 3. Backend Module Architecture

NestJS modular monolith - clean module boundaries so any module can later be extracted into its own service if the system outgrows a monolith. No microservices in v1.

```text
src/
├── auth/            # Passport strategies, JWT issuance, guards
├── users/
├── drivers/
├── vehicles/
├── rides/
│   ├── rides.controller.ts
│   ├── rides.service.ts
│   ├── ride-state-machine.ts
│   └── dto/
├── dispatch/
│   ├── dispatch.service.ts
│   ├── driver-matcher.service.ts
│   └── assignment.service.ts   # atomic accept/assign, Redis-locked
├── locations/
│   ├── location.gateway.ts     # WebSocket gateway
│   ├── location.service.ts
│   └── location-cache.service.ts
├── notifications/
│   ├── notifications.service.ts
│   └── queues/                 # BullMQ producers/consumers
├── maps/
│   ├── map-provider.interface.ts
│   ├── routing-provider.interface.ts
│   └── providers/
├── campus/
├── admin/
└── common/
```

Each domain module exposes a controller (versioned REST + OpenAPI decorators), a service (business logic), and - where relevant - a gateway (WebSocket) or queue processor (BullMQ). Cross-module calls go through service interfaces, never direct repository access across module boundaries.

### 4.1 Ride State Machine

Implemented as an explicit, backend-only state machine (`rides/ride-state-machine.ts`). See [specification.md §5](./specification.md#5-ride-state-machine) for the full transition diagram and invariants. The service layer is the only place allowed to mutate ride state; the controller never writes state directly.

### 4.2 Dispatch & Matching

v1 algorithm (intentionally simple):

```text
1. Find ONLINE drivers
2. Filter AVAILABLE drivers
3. Filter drivers inside the campus geofence
4. Compute distance from pickup (PostGIS)
5. Sort by distance
6. Offer to the closest driver, with a bounded response window (default 15s)
7. On reject/timeout -> offer to next driver
```

**Concurrency rule (hard requirement):** assignment must be atomic. Use a Redis lock (or a transactional conditional update) so that acceptance is a single "assign-if-still-searching" operation:

```text
if ride.status == SEARCHING_DRIVER:
    assign driver; status = DRIVER_ASSIGNED
else:
    reject this acceptance
```

This check-and-set must happen server-side inside `assignment.service.ts`; it must never be inferred from client-submitted state.

## 5. Database Layer (Drizzle ORM)

* Drizzle defines schema in TypeScript (`schema.ts` per module or a shared `db/schema/` directory), generating/validating migrations via `drizzle-kit`.
* PostgreSQL remains the single source of **business truth**; Redis never holds anything that isn't reconstructable from Postgres or safely transient.
* PostGIS types (geography/geometry columns) are modeled via Drizzle's `customType` for raw SQL geography columns, since Drizzle has no first-class PostGIS type - wrap `ST_*` calls in small helper query builders, not scattered raw SQL.
* Core tables: `users, drivers, vehicles, rides, ride_events, campus_locations` - see [specification.md §7](./specification.md#7-domain-data-model) for field-level intent; exact column definitions live in the Drizzle schema files, which are the source of truth once implementation starts (do not duplicate column lists in docs).
* `ride_events` is append-only and is the audit trail for every state transition - write it in the same transaction as the state change it records.

## 6. API Design & Versioning

* **OpenAPI-first contract.** NestJS's `@nestjs/swagger` generates the OpenAPI document from decorated controllers/DTOs; the generated spec is the contract published for the Admin frontend's typed client and for the Flutter apps' generated client.
* **URL versioning:** all routes are prefixed `/api/v1/...`. NestJS's built-in `VersioningType.URI` is used so `v2` can be introduced alongside `v1` without breaking existing mobile clients already in the field (important: unlike a web app, mobile clients can't be forced to upgrade instantly).
* Breaking changes require a new version prefix; additive changes (new optional fields, new endpoints) may ship within the current version.
* Representative v1 surface (full list evolves with implementation - treat this as illustrative, not exhaustive):

```http
POST   /api/v1/auth/login
POST   /api/v1/auth/verify
POST   /api/v1/auth/refresh

GET    /api/v1/users/me

POST   /api/v1/drivers/status
GET    /api/v1/drivers/me
POST   /api/v1/drivers/location

GET    /api/v1/vehicles
GET    /api/v1/vehicles/:id

POST   /api/v1/rides
GET    /api/v1/rides/:id
POST   /api/v1/rides/:id/cancel
POST   /api/v1/rides/:id/accept
POST   /api/v1/rides/:id/reject
POST   /api/v1/rides/:id/arrived
POST   /api/v1/rides/:id/start
POST   /api/v1/rides/:id/complete
GET    /api/v1/rides/history

GET    /api/v1/campus/locations
GET    /api/v1/campus/locations/:id

GET    /health
GET    /health/ready
GET    /health/live
```

* The Admin app consumes types generated directly from this OpenAPI document (see [frontend-guidelines.md](./frontend-guidelines.md)); Flutter apps generate a Dart client from the same document (e.g. via `openapi-generator`), keeping both frontends in lockstep with the backend contract without sharing source.

### 6.1 WebSocket Events

Namespace: `/ws`. The backend determines event *fan-out* per connection - a user only ever receives events for their own ride; a driver only for rides assigned to them. **Never broadcast all driver locations to all users.**

```text
ride.requested
ride.updated
ride.assigned
ride.cancelled

driver.location
driver.status

ride.driver_location
```

## 7. Frontend Architecture

### 7.1 Admin (React)

React + Tailwind + shadcn/ui + Base Web, consuming the OpenAPI-generated types and TanStack Query for data fetching/cache. Full conventions in [frontend-guidelines.md](./frontend-guidelines.md). Scope: driver/vehicle/user management, assignment, live operational dashboard, ride history.

### 7.2 User / Driver (Flutter)

Single Flutter codebase producing both the User and Driver apps (either as flavors/entry-points in one project, or two apps sharing a common package) for iOS and Android. Responsibilities:

* GPS acquisition and the location-push cadence defined in [specification.md §6](./specification.md#6-location--accuracy-rules)
* Map rendering (MapLibre GL Native), route/marker drawing, and the full in-app turn-by-turn navigation experience (see §8)
* Voice guidance via `flutter_tts`, driven by Valhalla maneuver narrative text
* WebSocket client for live ride/location updates, with reconnect/offline handling per [specification.md §8](./specification.md#8-error--edge-case-handling)
* Push notifications (FCM/APNs) for background/killed-app states

For each page provide modern and best user experience with:
- page transitions
- expanding/collapsing sections
- dropdowns
- dialogs
- buttons
- hover states
- loading states
- success states
- validation feedback

Use the improve-animations and review-animations and apple-design skills.
and make use if these skills to enhance the user experience 

The Flutter apps treat the backend as authoritative: no ride-state transition is considered real until the server confirms it.

## 8. Maps & Navigation

**Decision: fully open-source, self-hosted map/navigation stack** — no commercial map/routing API dependency.

| Concern | Choice |
|---|---|
| Map rendering (Flutter) | **MapLibre GL Native** via the `maplibre_gl` plugin ([quick start](https://makewithmaplibre.com/sdks/flutter-maplibre-gl-official/)) |
| Base map data | OSM extract for the campus region, built into vector tiles with **Planetiler** (OpenMapTiles schema) |
| Tile serving | **Martin** (or TileServer GL) — serves the base MBTiles *and* a live layer straight from PostGIS for campus overlay data, so admin edits to campus data show up without a tile rebuild |
| Routing / turn-by-turn | **Valhalla**, self-hosted, built from the same OSM extract — chosen over OSRM because its route responses include ready-to-speak maneuver narrative text, which turn-by-turn voice guidance needs out of the box |
| Voice playback | `flutter_tts`, speaking Valhalla's maneuver narration at distance-based thresholds |

The backend's `maps/` module keeps the existing `MapProvider`/`RoutingProvider` interface pattern — Valhalla is the concrete implementation behind `RoutingProvider`, called server-side (so route requests are authenticated, auditable, and rate-limited through the same OpenAPI-versioned surface as everything else). The Flutter apps talk to the tile server directly for tiles (static-asset style traffic, not worth proxying through the API) but go through the NestJS `maps/` module for routing.

`RoutingProvider`'s Valhalla implementation calls Valhalla's [`/route` endpoint](https://valhalla.github.io/valhalla/api/route/overview/) directly:

* `locations` — pickup/driver and destination coordinates (`type: break`, optional `heading` from the driver's last known heading so the route starts in the direction of travel)
* `costing` — see [§8.2](#82-custom-campus-road-network--ev-specific-routing) for the EV-specific profile choice
* `directions_type: maneuvers` with `language` set from the user's locale, so narrative text comes back pre-localized
* `units: kilometers` (or `miles`, campus-configurable)
* `exclude_polygons` — dynamic no-go zones, see [§8.2](#82-custom-campus-road-network--ev-specific-routing)

The response's `trip.legs[].maneuvers[]` array is the single source for most of the turn-by-turn UI: `instruction` / `verbal_pre_transition_instruction` / `verbal_transition_alert_instruction` / `verbal_post_transition_instruction` for display and voice, `length` / `time` per maneuver, and `begin_shape_index`/`end_shape_index` to map each maneuver back onto the route's `shape` polyline for distance-to-maneuver tracking.

### 8.1 Feature → Implementation Mapping

| Requested feature | How it's implemented |
|---|---|
| Route line on the map | `trip.legs[].shape` (encoded polyline) decoded and drawn as a MapLibre `LineLayer` |
| Moving vehicle marker | MapLibre symbol layer; position updated from `driver.location` / `ride.driver_location` WebSocket events, interpolated between ticks for smooth motion |
| Current GPS position | Device location (`geolocator` package) rendered as the viewer's own location puck, separate from the vehicle marker |
| Map rotation following heading | MapLibre camera `bearing` synced to the `heading` field already captured per [specification.md §6](./specification.md#6-location--accuracy-rules) |
| Turn-by-turn instructions | `maneuvers[].instruction` (display) and `verbal_pre_transition_instruction` (speech), rendered in the nav UI |
| Distance to next maneuver | `maneuvers[].length` minus distance already covered within that maneuver, recomputed from live GPS against `begin_shape_index`/`end_shape_index` each location tick |
| ETA | Sum of remaining `maneuvers[].time` from the current position, refreshed as the ride progresses |
| Voice instructions | `flutter_tts` speaking `verbal_pre_transition_instruction` / `verbal_transition_alert_instruction` / `verbal_post_transition_instruction` at the appropriate distance thresholds |
| Automatic rerouting on deviation | Client-side off-route detection (perpendicular distance from the active `shape` polyline exceeds a threshold) triggers a fresh `/route` request from current position to the original destination |
| Route progress | Cumulative distance traveled along `shape` vs. `trip.summary.length` |
| Pickup / destination markers | MapLibre symbol layer at the ride's pickup/destination coordinates, using the custom icon set below |
| Custom EV/organization icons | Registered via `MapLibreMap.addImage()` and referenced by the vehicle, pickup, and destination symbol layers |
| Custom campus roads & POIs | `campus_locations` (+ `campus_roads`, see [specification.md §7](./specification.md#7-domain-data-model)) served as a dedicated vector layer straight from PostGIS via Martin, added as an extra MapLibre source/layer on top of the base map |

### 8.2 Custom Campus Road Network & EV-Specific Routing

Because the campus is organization-specific, the public OSM graph alone is insufficient — most internal EV paths, gates, and restricted-access routes simply aren't mapped publicly. Two separate mechanisms handle this, one static and one dynamic:

**Static: a custom-built routing graph.** The organization maintains `campus_roads` — digitized internal road/path geometry (GPS-walked or hand-drawn by an Admin GIS workflow) stored in PostGIS. Before each Valhalla tile build, this is exported to a small OSM-format overlay and merged into the regional OSM extract with `osmium merge`, so Valhalla's graph includes roads that exist only on the premises. This is how "specific areas are included for EV navigation" — an internal path isn't routable until it exists in this overlay.

**Dynamic: per-request exclusion zones.** Not every restriction should require a map rebuild (a plaza closed for an event, a construction zone, a VIP-only area on a given day). `campus_restricted_zones` (polygon geometry + active flag + reason, in PostGIS) is read by the `maps/` module and passed as Valhalla's `exclude_polygons` on every `/route` call, so a zone can be opened/closed operationally without touching the graph build.

**Costing profile.** Valhalla ships no dedicated "golf cart/EV" costing out of the box. v1 uses `costing: auto` with tuned `costing_options.auto` (e.g. `use_tracks`, `use_living_streets`, low `service_penalty`) so campus-tagged service/track ways are preferred; `motor_scooter` costing (lower default speeds, closer to actual EV speeds on campus) should be evaluated as an alternative during Phase 3/6 implementation — tracked in [plan.md](./plan.md) as an open decision, not pre-committed here.

**Rebuild trigger.** Because the campus overlay changes only when someone edits campus road data (not continuously, unlike public OSM), the Valhalla tile rebuild is Admin-triggered (a button/job in the Admin app that re-runs the extract-merge-build pipeline), not on a fixed schedule.

Containers and operational detail for the tile server and Valhalla live in [§9.5 Maps & Navigation Layer](#95-maps--navigation-layer).

## 9. Infrastructure Topology

```text
                      Campus Network / Internet
                                |
                                v
                         Reverse Proxy
                                |
                                v
                 +-------------------------------+
                 |     Application Layer         |
                 |  NestJS in Docker containers  |
                 |  on on-prem Kubernetes        |
                 +---------------+---------------+
                                 |
                 +---------------+----------------+
                 |                                |
                 v                                v
   +-----------------------------+   +------------------------------+
   |  State & Cache Layer         |   |      Storage Layer           |
   |  Redis                       |   |      PostgreSQL + Drizzle    |
   |  - BullMQ queues              |   |      ACID business truth    |
   |    (automated release        |   +------------------------------+
   |     actions)                 |
   |  - Fast-changing availability|
   |    grids / presence / cache  |
   +-----------------------------+

                 +-------------------------------+
                 |       Identity Layer          |
                 |  NestJS Passport hooks  ->     |
                 |  - Google OAuth (SSO)         |
                 |  - Mobile OTP                 |
                 +-------------------------------+

                 +-------------------------------+
                 |   Maps & Navigation Layer     |
                 |  - Tile server (Martin/        |
                 |    TileServer GL)              |
                 |  - Valhalla routing engine     |
                 |  self-hosted, open-source      |
                 +-------------------------------+
```

### 9.1 Application Layer

NestJS runs as stateless Docker containers behind the on-prem Kubernetes cluster's ingress/reverse proxy. Horizontal scaling is safe because all session/presence state lives in Redis, not in-process - any pod can serve any request. WebSocket connections require sticky routing or a Redis-backed adapter (`@nestjs/platform-socket.io` + Redis adapter) so events fan out correctly across replicas.

### 9.2 State & Cache Layer

Redis serves two distinct purposes and should be reasoned about separately even though it's one deployment:

* **BullMQ queues** - automated release actions (e.g. releasing a vehicle back to `AVAILABLE` after a timeout, retrying a failed push notification, driver-offer timeout escalation to the next driver).
* **Fast-changing state cache** - driver presence/online status, current driver location, active-ride state, availability grids (which drivers/vehicles are free right now). This is the same role Redis already plays per [specification.md §6](./specification.md#6-location--accuracy-rules): transient, expiring, never the system of record.

### 9.3 Storage Layer

PostgreSQL + Drizzle is the ACID-compliant system of record for everything that must survive and be queryable historically: users, drivers, vehicles, rides, ride_events, campus_locations. PostGIS extension is enabled for geofencing and nearest-driver queries (see §4.2).

### 9.4 Identity Layer

NestJS Passport strategies sit directly in front of the Auth module:

* **Google OAuth** - SSO path, primarily for Admin/Operator staff accounts tied to an organizational Google Workspace.
* **Mobile OTP** - primary path for User/Driver accounts (mobile-number + OTP, no password), matching the Flutter apps' sign-in flow.

**Concrete provider: Firebase Authentication.** Rather than building and operating custom OTP/SMS delivery, both flows are handled client-side by the Firebase Auth SDK (Phone-OTP in Flutter, Google Sign-In in both Flutter and the Admin React app), which returns a Firebase ID token. The backend's `FirebaseStrategy` verifies that token server-side via `firebase-admin`, resolves it to a `users` row (by `firebase_uid`, auto-provisioning on first login for role `USER` only - `DRIVER`/`ADMIN`/`OPERATOR` accounts must already exist, created by an Admin), and issues our own app JWT (access + refresh). Both strategies terminate in the same JWT issuance path so downstream RBAC/guards are identical regardless of how the user authenticated.

### 9.5 Maps & Navigation Layer

Self-hosted, open-source, deployed as its own set of Docker containers on the on-prem Kubernetes cluster alongside the application pods:

* **Tile server** (Martin or TileServer GL) — serves base vector tiles built from an OSM extract via Planetiler, plus a live vector layer read straight from the `campus_locations`/`campus_roads` PostGIS tables so campus overlay edits appear without a tile rebuild. Served directly to the Flutter apps (static-asset traffic; not proxied through the NestJS API).
* **Valhalla** — routing engine built from the same OSM extract merged with the organization's custom `campus_roads` overlay (see [§8.2](#82-custom-campus-road-network--ev-specific-routing)), so its graph includes campus-private EV paths that don't exist in public OSM data. Called server-side through the NestJS `maps/` module ([§8](#8-maps--navigation)), not directly from the apps.
* `campus_restricted_zones` is read by the `maps/` module and passed as Valhalla's `exclude_polygons` per request — a dynamic, no-rebuild-needed way to close/reopen areas to EV routing.
* The Valhalla tile rebuild (and the matching Martin/tile-server refresh) is an **Admin-triggered pipeline job**, run whenever `campus_roads` changes — not a fixed schedule, since the campus overlay only changes when someone edits it.

## 10. Observability

* Structured JSON logging from day one.
* Health endpoints: `GET /health`, `/health/ready`, `/health/live`.
* Recommended metrics (Prometheus-style): `ride_requests_total`, `ride_completed_total`, `ride_cancelled_total`, `ride_assignment_duration_seconds`, `active_rides`, `available_drivers`, `driver_location_updates_total`, `websocket_connections`, `push_notifications_total`.

## 11. Deployment

Container-ready from the start: Docker images for the NestJS API, deployed to on-prem Kubernetes (see §9.1). Local/dev environments may use Docker Compose for a lighter-weight equivalent of the same topology. CI/CD pipeline and environment promotion strategy are tracked in [plan.md](./plan.md).

## 12. Why a Modular Monolith, Not Microservices (v1)

The initial domain (users, drivers, vehicles, rides, locations, dispatch, notifications) is small enough that splitting into independent services up front would add distributed-transaction, service-discovery, inter-service auth, and deployment complexity without a corresponding benefit. NestJS's module boundaries give the needed separation now; any module can be extracted into its own service later if load or team structure requires it.
