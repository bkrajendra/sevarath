# SevaRath - Implementation Plan

> Back to [README](../README.md) · See also [Specification](./specification.md) · [Architecture & Design](./architecture.md)

## 1. Open Decisions

Track before/at the start of the relevant phase - not blocking documentation, but should be resolved before the dependent phase begins:

| Decision | Options | Needed by |
|---|---|---|
| Location retention policy | Whether/how long raw driver location history is persisted beyond Redis TTL | Phase 5 |
| On-prem Kubernetes specifics | Cluster access, ingress, CI/CD deployment target | Phase 1 |
| Valhalla costing profile for EVs | `auto` with tuned `costing_options` vs. `motor_scooter` (closer default speed to a campus EV) - see [architecture.md §8.2](./architecture.md#82-custom-campus-road-network--ev-specific-routing) | Phase 6 |
| Campus-private road data entry | How `campus_roads` geometry is authored/maintained (Admin-app editor vs. GIS import) and merged into the OSM extract before Valhalla's graph build | Phase 3 |
| Public OSM extract refresh cadence | How often the regional base extract is re-pulled (separate from the Admin-triggered campus-overlay rebuild, which fires on demand) | Phase 3 |

**Decided:** map rendering, tiles, and routing are a fully open-source, self-hosted stack - MapLibre GL Native (Flutter) + Martin/TileServer GL + Valhalla. See [architecture.md §8](./architecture.md#8-maps--navigation).

**Decided:** User and Driver are **one Flutter codebase, two build flavors** - not two separate apps. Shared screens/widgets/API client live in one `lib/`, and flavor-specific config (app name, bundle/package id, icon, entry point, feature flags like "show driver-only screens") is injected per-flavor via Flutter's native flavor mechanism (`--flavor user|driver` + `-t lib/main_user.dart`/`lib/main_driver.dart`, Android `productFlavors`, iOS schemes), each producing a distinct installable app from the same source. See [architecture.md §7.2](./architecture.md#72-user--driver-flutter).

## 2. Phased Delivery

Each phase lists its concrete deliverable - a phase isn't "done" until the deliverable demonstrably works, not just when the code is written.

### Phase 1 - Foundation

* Repo scaffolding (NestJS API, Drizzle schema/migrations, Docker Compose for local dev)
* CI/CD skeleton
* PostgreSQL + PostGIS, Redis
* Auth module: Mobile OTP + Google OAuth (Passport strategies), JWT issuance, RBAC guards
* OpenAPI document generation wired up (`@nestjs/swagger`) from day one, not bolted on later
* Base logging (structured JSON)

**Deliverable:** User and Driver can authenticate; Admin staff can authenticate via SSO.

### Phase 2 - Driver & Vehicle Management

* Driver profile, vehicle entity, driver↔vehicle assignment
* Driver status (`OFFLINE/AVAILABLE/BUSY/ON_BREAK`)
* Admin app bootstrap (React + Tailwind + shadcn/ui + baseui per [frontend-guidelines.md](./frontend-guidelines.md)), consuming the OpenAPI client

**Deliverable:** Driver can go online/offline; Admin can create/approve drivers and vehicles.

### Phase 3 - Campus Map & Location Selection

* Stand up the Maps & Navigation infra: OSM extract for the campus region, Planetiler tile build, Martin/TileServer GL serving base tiles + a live PostGIS-backed layer ([architecture.md §9.5](./architecture.md#95-maps--navigation-layer))
* `campus_locations`, `campus_roads`, and `campus_restricted_zones` data + endpoints
* Admin-triggered rebuild job: campus overlay → OSM merge (`osmium`) → Valhalla graph build → tile refresh ([architecture.md §8.2](./architecture.md#82-custom-campus-road-network--ev-specific-routing))
* `RoutingProvider` interface with its concrete Valhalla implementation ([architecture.md §8](./architecture.md#8-maps--navigation))
* Flutter app: MapLibre integration, campus map rendering (base + campus overlay layers), pickup/destination selection, current GPS

**Deliverable:** User can see the campus map (with custom campus roads/POIs) and select pickup/destination.

### Phase 4 - Booking & Dispatch

* `rides` entity, ride state machine (server-authoritative - [specification.md §5](./specification.md#5-ride-state-machine))
* Nearest-available-driver matching (PostGIS distance query)
* Atomic accept/assign (Redis lock - [architecture.md §4.2](./architecture.md#42-dispatch--matching))
* Accept/reject/cancel endpoints; `ride_events` audit writes

**Deliverable:** Full request → match → accept loop: user requests, nearest driver is offered the ride, driver accepts, user sees the assignment.

### Phase 5 - Real-Time Location

* WebSocket gateway (`/ws`), Redis-backed Socket.IO adapter for multi-pod fan-out
* Driver location push pipeline (Flutter → gateway → Redis → WebSocket → User app)
* Live tracking UI in both Flutter apps

**Deliverable:** Driver movement is visible to the assigned user in near real time.

### Phase 6 - Navigation

* Valhalla route request/response wired end-to-end through the `maps/` module
* In-app turn-by-turn UI: route line, pickup/destination/vehicle markers with custom icons, heading-based map rotation, distance-to-maneuver, ETA, route progress
* Voice guidance (`flutter_tts`) driven by Valhalla's maneuver narrative
* Off-route detection and automatic rerouting

**Deliverable:** Driver gets full turn-by-turn guidance (visual + voice) to pickup and to destination, with automatic rerouting on deviation - see [specification.md §3.4](./specification.md#34-navigation--map-user--driver-apps) for the full feature list.

### Phase 7 - Notifications

* BullMQ-backed notification queue
* Push notifications (FCM/APNs) for background/killed-app states, covering: ride accepted, driver arriving/arrived, ride started/completed, cancellations

**Deliverable:** Key ride events reach the user/driver even when the app isn't in the foreground.

### Phase 8 - Admin Operations

* Full Admin surface: users, drivers, vehicles, active rides, campus locations, ride history
* Operational dashboard (live counts + campus map overlay - [specification.md §9](./specification.md#9-operational-dashboard-admin))

**Deliverable:** Operations team has a working live view and historical audit trail.

### Phase 9 - Hardening

* Observability: metrics, health checks, error tracking wired to the dashboards operations will actually use
* Offline/reconnection hardening (driver app network loss - [specification.md §8](./specification.md#8-error--edge-case-handling))
* Security review: token rotation, rate limiting, WebSocket auth, audit logging coverage

**Deliverable:** System survives network flakiness and passes a security review before wider rollout.

## 3. Development Priority (within/across phases)

```text
1. Authentication
2. User/Driver roles
3. Driver + Vehicle management
4. Ride state machine
5. Booking API
6. Driver dispatch
7. Driver acceptance (atomic assignment)
8. WebSocket infrastructure
9. Driver location pipeline
10. User live tracking
11. Campus map
12. Routing/navigation
13. Push notifications
14. Ride history
15. Admin dashboard
16. Observability
17. Offline/reconnection hardening
18. Production security review
```

The **ride state machine, dispatch/assignment logic, and real-time location pipeline** are the core engineering risk areas - prioritize design review and test coverage there over any other component.
