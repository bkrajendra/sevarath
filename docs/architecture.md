# SevaRath - Architecture & Technical Design

> Back to [README](../README.md) · See also [Specification](./specification.md) · [Frontend Guidelines](./frontend-guidelines.md) · [Implementation Plan](./plan.md) · [Booking Architecture Spec](./sevarath-booking-architecture-spec.md)

> **Terminology:** [sevarath-booking-architecture-spec.md](./sevarath-booking-architecture-spec.md) uses "booking" for what this document and the codebase call a **ride** (`rides` table, `RidesModule`). They are the same entity - read "booking" as "ride" wherever the two docs are cross-referenced.

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
├── events/
│   ├── outbox/                  # outbox_events writer (same tx as the state change)
│   └── publisher/               # polling worker, publishes to BullMQ/Redis - see §4.3
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

**Concurrency rule (hard requirement):** assignment must be atomic. **Decided mechanism: a single transactional conditional `UPDATE`, not a Redis lock** - this keeps PostgreSQL the sole arbiter of acceptance and needs no distributed-lock infrastructure:

```sql
UPDATE rides
SET driver_id = :driverId, vehicle_id = :vehicleId, status = 'DRIVER_ASSIGNED', accepted_at = now()
WHERE id = :rideId AND status = 'SEARCHING_DRIVER';
-- 1 row affected -> this driver won.
-- 0 rows affected -> return RIDE_ALREADY_ASSIGNED; do not touch ride state.
```

This check-and-set must happen server-side inside `assignment.service.ts`; it must never be inferred from client-submitted state. Do not rely on WebSocket delivery order to prevent double acceptance (see [sevarath-booking-architecture-spec.md §9](./sevarath-booking-architecture-spec.md)).

**Per-driver offer tracking.** `rides.status = SEARCHING_DRIVER` covers the *whole* cascade across candidate drivers, but which individual driver currently holds the live offer - and whether their 15s window expired - needs its own record, not a `rides.status` value. Add a `ride_offers` table:

```text
ride_offers
-----------
id
ride_id
driver_id
offered_at
responded_at
result            -- PENDING | ACCEPTED | REJECTED | EXPIRED
```

`dispatch.service.ts` inserts one row per offer, the driver app's accept/reject call updates it, and a scheduled timeout (BullMQ delayed job) marks it `EXPIRED` and triggers the next-driver offer. The assignment-winning `UPDATE` above is still what makes `ACCEPTED` authoritative; `ride_offers` only drives the notify-and-cascade sequencing (this is the `DRIVER_NOTIFIED` / `EXPIRED` detail from [sevarath-booking-architecture-spec.md §6](./sevarath-booking-architecture-spec.md)).

### 4.3 Events & Transactional Outbox

Reliable delivery of ride-lifecycle events (to the WebSocket gateway, push notifications, audit/metrics) uses the **Transactional Outbox** pattern, per [sevarath-booking-architecture-spec.md §12](./sevarath-booking-architecture-spec.md):

```text
outbox_events
--------------
id
event_type        -- RideRequested, RideAssigned, RideCancelled, DriverArrived, RideStarted, RideCompleted, ...
aggregate_type     -- 'ride'
aggregate_id       -- ride.id
payload            -- minimal JSON: ids + correlationId, not the full ride row
created_at
published_at
retry_count
last_error
```

The ride-state write and its `outbox_events` insert happen in the **same database transaction** as the state change (`rides.service.ts` / `assignment.service.ts`), so an event can never be "lost" relative to the state it describes, and can never be published for a transaction that rolled back.

**This repo has no existing message broker** (`docker-compose.yml` only provisions Postgres+PostGIS and Redis - no ActiveMQ/RabbitMQ/Kafka). Per the booking spec's own fallback ("a PostgreSQL-backed worker/queue... if an additional broker is not justified"), the publisher is a small polling worker that reads unpublished `outbox_events` rows and hands them to the **existing BullMQ/Redis** queue, which `locations`/`notifications`/`realtime` modules already consume from. Keep the publisher behind an `EventPublisher` interface so a real broker can replace BullMQ later without touching `rides`/`dispatch`.

```text
outbox_events (unpublished)
     |
     v
EventPublisher (polling worker)
     |
     v
BullMQ (Redis)
     |
     +--> WebSocket Gateway  (ride.* events to user/driver)
     +--> Notifications queue (push notifications)
     |
     v
published_at = now()
```

Failed publishing increments `retry_count` / sets `last_error` and is retried; it never blocks the original ride-state transaction, which already committed.

## 5. Database Layer (Drizzle ORM)

* Drizzle defines schema in TypeScript (`schema.ts` per module or a shared `db/schema/` directory), generating/validating migrations via `drizzle-kit`.
* PostgreSQL remains the single source of **business truth**; Redis never holds anything that isn't reconstructable from Postgres or safely transient.
* PostGIS types (geography/geometry columns) are modeled via Drizzle's `customType` for raw SQL geography columns, since Drizzle has no first-class PostGIS type - wrap `ST_*` calls in small helper query builders, not scattered raw SQL.
* Core tables: `users, drivers, vehicles, rides, ride_events, campus_locations` - see [specification.md §7](./specification.md#7-domain-data-model) for field-level intent; exact column definitions live in the Drizzle schema files, which are the source of truth once implementation starts (do not duplicate column lists in docs).
* `ride_events` is append-only and is the audit trail for every state transition - write it in the same transaction as the state change it records.
* `ride_offers` (new, Phase 4) tracks the per-driver notify/accept/reject/expire cascade during `SEARCHING_DRIVER` - see [§4.2](#42-dispatch--matching).
* `outbox_events` (new, Phase 4) backs reliable domain-event publishing - see [§4.3](#43-events--transactional-outbox).
* `driver_locations` (optional, Phase 5) is **not** created by default - [specification.md §6](./specification.md#6-location--accuracy-rules) keeps current driver location in Redis only, with no permanent raw-GPS history. Only add this table if the location-retention policy ([plan.md Open Decisions](./plan.md#1-open-decisions)) decides a persisted history is operationally required (e.g. safety/incident review).

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

### 6.2 Idempotency

Per [sevarath-booking-architecture-spec.md §17](./sevarath-booking-architecture-spec.md), mobile clients may retry a command after a dropped response without knowing if it already applied. The following commands accept a client-generated `Idempotency-Key` header:

```text
POST /api/v1/rides
POST /api/v1/rides/:id/accept
POST /api/v1/rides/:id/cancel
POST /api/v1/rides/:id/start
POST /api/v1/rides/:id/complete
```

Implementation: a unique constraint on `(user_or_driver_id, idempotency_key)` scoped per endpoint (e.g. a small `idempotency_keys` table storing the key, the resulting resource id, and the response status, with a TTL cleanup job), checked before the write and returning the original response on a replay instead of re-running the command. See [specification.md §11.1](./specification.md#111-idempotency) for the functional requirement.

## 7. Frontend Architecture

### 7.1 Admin (React)

React + Tailwind + shadcn/ui + Base Web, consuming the OpenAPI-generated types and TanStack Query for data fetching/cache. Full conventions in [frontend-guidelines.md](./frontend-guidelines.md). Scope: driver/vehicle/user management, assignment, live operational dashboard, ride history.

### 7.2 User / Driver (Flutter)

One Flutter codebase, two build flavors - `user` and `driver` - each with its own entry point (`lib/main_user.dart` / `lib/main_driver.dart`), app name/icon/bundle id, and a feature flag gating driver-only screens, producing two distinct installable apps for iOS and Android from shared source. Responsibilities:

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

NestJS Passport strategies sit directly in front of the Auth module. Two independent paths both terminate in the same JWT issuance (`AuthService.issueTokens`), so downstream RBAC/guards are identical regardless of how the user authenticated:

* **Mobile/email + password (primary, self-hosted).** `POST /auth/register` and `POST /auth/login/password`, backed by a bcrypt-hashed `password_hash` column on `users`. Chosen over Firebase as the default path to keep the system fully on-premise/open-source and avoid Firebase's paid tiers for production SMS delivery. No OTP verification yet - mobile numbers are taken at face value on registration; OTP verification is a follow-up phase.
* **Firebase (Google OAuth SSO + Phone-OTP) - optional, not currently wired into either Flutter app's UI.** The code (`FirebaseStrategy`, `POST /auth/login` with a Firebase ID token) is untouched and still works end-to-end once a Firebase project's client config is added to the Flutter apps; it's simply not the default sign-up/sign-in flow right now. `DRIVER`/`ADMIN`/`OPERATOR` accounts via this path still must be pre-provisioned by an Admin, as before.

**Concrete provider for the optional path: Firebase Authentication**, as previously described - handled client-side by the Firebase Auth SDK, verified server-side via `firebase-admin`.

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
* Outbox-specific metrics (added with Phase 4's Transactional Outbox, [§4.3](#43-events--transactional-outbox)): `outbox_pending_events`, `outbox_publish_failures_total`, `outbox_publish_latency_seconds`.
* Every log line and metric tied to a ride carries `bookingId`/`rideId` and `correlationId` so a single ride can be traced end-to-end across the REST call, the outbox event, and the WebSocket delivery - see [sevarath-booking-architecture-spec.md §19](./sevarath-booking-architecture-spec.md).

## 11. Deployment

Container-ready from the start: Docker images for the NestJS API, deployed to on-prem Kubernetes (see §9.1). Local/dev environments may use Docker Compose for a lighter-weight equivalent of the same topology. CI/CD pipeline and environment promotion strategy are tracked in [plan.md](./plan.md).

## 12. Why a Modular Monolith, Not Microservices (v1)

The initial domain (users, drivers, vehicles, rides, locations, dispatch, notifications) is small enough that splitting into independent services up front would add distributed-transaction, service-discovery, inter-service auth, and deployment complexity without a corresponding benefit. NestJS's module boundaries give the needed separation now; any module can be extracted into its own service later if load or team structure requires it.
