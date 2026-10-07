# SevaRath - Implementation Plan

> Back to [README](../README.md) · See also [Specification](./specification.md) · [Architecture & Design](./architecture.md) · [Booking Architecture Spec](./sevarath-booking-architecture-spec.md)

## 0. Current Status (as of 2026-10-07)

Reconciled against the actual repo state, not just doc intent - verified by reading `apps/api/src`, `apps/mobile/lib`, `apps/admin/src`, `docker-compose.yml`.

| Phase | Status | Notes |
|---|---|---|
| 1 - Foundation | **Done** | Auth (password + optional Firebase), JWT/RBAC guards, Swagger, structured logging base. |
| 2 - Driver & Vehicle Management | **Done** | `drivers`/`vehicles` schema + controllers/services, availability enum, Admin app bootstrap with Drivers/Vehicles pages. |
| 3 - Campus Map & Location Selection | **Mostly done** | Backend/infra verified live (campus data + Martin + Valhalla + `RoutingProvider`). Flutter UI flow fully built but still on mock ride data; driver-flavor screens and Android build flavors not started. See checklist below (unchanged from before this update). |
| 4 - Booking & Dispatch | **Done** | Full ride lifecycle, dispatch cascade, atomic accept, transactional outbox, and idempotency keys implemented and tested end-to-end (real HTTP, real Postgres/Redis) - see the Phase 4 section below and [docs/open-items.md](./open-items.md) for the handful of deliberately deferred gaps. This is now the current critical path's *base* for Phase 5, not the gap itself. |
| 5 - Real-Time Location | **Backend done** | WebSocket gateway, durable-event forwarding, live GPS pipeline, and reconnect/resync are all implemented and tested end-to-end (real Postgres/Redis/WebSocket). The Flutter live-tracking UI is not started - see the Phase 5 section below. |
| 6 - Navigation | **Partially started** | Backend `GET /api/v1/maps/route` + Valhalla integration done (pulled forward into Phase 3). In-app turn-by-turn UI, voice guidance, off-route rerouting in Flutter: not started. |
| 7 - Notifications | **Backend done** | Device token registration + FCM push consumer implemented and tested (mocked Firebase - no real project configured here, so no push has been verified against a real device). See the Phase 7 section below. |
| 8 - Admin Operations | **Partially started** | Admin app has CRUD pages for Drivers/Vehicles/CampusLocations. `apps/api/src/admin/admin.module.ts` is an empty scaffold - no live-ops dashboard (active rides, counts) exists yet. |
| 9 - Hardening | **Not started** | No metrics, no outbox, no idempotency keys, no load/failure-scenario tests yet. |

**Bottom line:** the full booking core now works end-to-end - a user can request a ride, get matched to the nearest real driver, have it accepted, and ride it through to completion and history, all server-authoritative with reliable event publishing and safe retries. What's still greenfield: real-time delivery (no WebSocket gateway yet - clients would have to poll today), turn-by-turn navigation UI, push notifications, and the operational/hardening work. See §4 below for the reconciled next steps.

## 1. Open Decisions

Track before/at the start of the relevant phase - not blocking documentation, but should be resolved before the dependent phase begins:

| Decision | Options | Needed by |
|---|---|---|
| Location retention policy | Whether/how long raw driver location history is persisted beyond Redis TTL | Phase 5 |
| On-prem Kubernetes specifics | Cluster access, ingress, CI/CD deployment target | Phase 1 |
| Valhalla costing profile for EVs | `auto` with tuned `costing_options` vs. `motor_scooter` (closer default speed to a campus EV) - see [architecture.md §8.2](./architecture.md#82-custom-campus-road-network--ev-specific-routing) | Phase 6 |
| Campus-private road data entry | How `campus_roads` geometry is authored/maintained (Admin-app editor vs. GIS import) and merged into the OSM extract before Valhalla's graph build | Phase 3 |
| Public OSM extract refresh cadence | How often the regional base extract is re-pulled (separate from the Admin-triggered campus-overlay rebuild, which fires on demand) | Phase 3 |
| Mobile OTP verification | Deferred - registration currently trusts the mobile number as entered, no SMS verification | Before production rollout |

**Decided (from reconciling [sevarath-booking-architecture-spec.md](./sevarath-booking-architecture-spec.md), 2026-10-07):** domain-event delivery uses a **Transactional Outbox** (`outbox_events` table, written in the same transaction as the ride-state change) published by a polling worker onto the **existing Redis/BullMQ** - not a new message broker. This repo has no ActiveMQ/RabbitMQ/Kafka (`docker-compose.yml` only has Postgres and Redis), so the booking spec's "existing broker" assumption does not apply here; its own documented fallback is what's adopted. See [architecture.md §4.3](./architecture.md#43-events--transactional-outbox).

**Decided:** driver-acceptance concurrency safety is a single transactional conditional `UPDATE ... WHERE status = 'SEARCHING_DRIVER'` (not a Redis lock) - simpler, and keeps Postgres as the sole arbiter per [architecture.md §4.2](./architecture.md#42-dispatch--matching). A new `ride_offers` table tracks the per-driver notify/accept/reject/expire cascade underneath `SEARCHING_DRIVER` (the `DRIVER_NOTIFIED`/`EXPIRED` detail from the booking spec).

**Decided:** mutating ride commands (`create`, `accept`, `cancel`, `start`, `complete`) require client-supplied `Idempotency-Key` support - see [specification.md §11.1](./specification.md#111-idempotency) and [architecture.md §6.2](./architecture.md#62-idempotency). Build this into Phase 4, not deferred to Phase 9 hardening, since mobile retries are expected from day one of booking.

**Decided:** map rendering, tiles, and routing are a fully open-source, self-hosted stack - MapLibre GL Native (Flutter) + Martin/TileServer GL + Valhalla. See [architecture.md §8](./architecture.md#8-maps--navigation).

**Decided:** User and Driver are **one Flutter codebase, two build flavors** - not two separate apps. Shared screens/widgets/API client live in one `lib/`, and flavor-specific config (app name, bundle/package id, icon, entry point, feature flags like "show driver-only screens") is injected per-flavor via Flutter's native flavor mechanism (`--flavor user|driver` + `-t lib/main_user.dart`/`lib/main_driver.dart`, Android `productFlavors`, iOS schemes), each producing a distinct installable app from the same source. See [architecture.md §7.2](./architecture.md#72-user--driver-flutter).

## 2. Phased Delivery

Each phase lists its concrete deliverable - a phase isn't "done" until the deliverable demonstrably works, not just when the code is written.

### Phase 1 - Foundation `[DONE]`

* Repo scaffolding (NestJS API, Drizzle schema/migrations, Docker Compose for local dev)
* CI/CD skeleton
* PostgreSQL + PostGIS, Redis
* Auth module: Mobile OTP + Google OAuth (Passport strategies), JWT issuance, RBAC guards
* OpenAPI document generation wired up (`@nestjs/swagger`) from day one, not bolted on later
* Base logging (structured JSON)

**Deliverable:** User and Driver can authenticate; Admin staff can authenticate via SSO.

### Phase 2 - Driver & Vehicle Management `[DONE]`

* Driver profile, vehicle entity, driver↔vehicle assignment
* Driver status (`OFFLINE/AVAILABLE/BUSY/ON_BREAK`)
* Admin app bootstrap (React + Tailwind + shadcn/ui + baseui per [frontend-guidelines.md](./frontend-guidelines.md)), consuming the OpenAPI client

**Deliverable:** Driver can go online/offline; Admin can create/approve drivers and vehicles.

### Phase 3 - Campus Map & Location Selection

* [x] `campus_locations`, `campus_roads`, and `campus_restricted_zones` data + endpoints, plus an Admin UI page for locations
* [x] Stand up Martin, live-serving `campus_roads`/`campus_restricted_zones` straight from PostGIS (no build step) - see [k8s/maps/](../k8s/maps/README.md)
* [x] Real OSM extract for the campus region (Abu Road/Shantivan bbox via Overpass API - see [infra/maps-data/](../infra/maps-data/README.md)) and a working Valhalla graph build pipeline (verified: real turn-by-turn routes returned from the live service)
* [x] `RoutingProvider` interface with its concrete Valhalla implementation, plus a `GET /api/v1/maps/route` endpoint ([architecture.md §8](./architecture.md#8-maps--navigation))
* [ ] Planetiler-built base map vector tiles (building footprints/roads/land use) - Martin currently only serves the PostGIS campus-overlay layer, not a full base map
* [ ] Admin-triggered rebuild job as an actual Admin-app button (currently a manual `kubectl` pipeline - see [k8s/maps/README.md](../k8s/maps/README.md))
* [x] Flutter app scaffolded (`apps/mobile`, one codebase/two flavors - `lib/main_user.dart`/`lib/main_driver.dart`) with the full User-app UI flow built against `docs/branding-ui.png`: splash, home, select destination, confirm ride (live MapLibre map), finding vehicle, driver en route, on the way, ride details, rate ride, profile. Screens use mock data (`lib/features/ride/models/mock_campus_data.dart`) - wiring to apps/api is a follow-up.
* [x] Wire the Flutter app to apps/api - real mobile/email+password auth and real campus locations (see docs/architecture.md §9.4 for the password-vs-Firebase decision). Booking is still mock data - blocked on Phase 4 (`rides`/`dispatch` are empty scaffold modules, not yet implemented).
* [ ] Driver-flavor-specific screens (go online/offline, accept/reject) - `main_driver.dart` currently boots the same placeholder shell as the user flavor
* [ ] Android build flavors (Gradle `productFlavors`) / iOS schemes - not yet wired; Android SDK cmdline-tools also need installing in this dev environment before Android builds work at all

**Deliverable:** User can see the campus map (with custom campus roads/POIs) and select pickup/destination. *(Backend/infra side is done and verified live; the Flutter side - the actual deliverable - is next once Flutter tooling is set up.)*

### Phase 4 - Booking & Dispatch `[DONE]`

* [x] `rides` entity, ride state machine (server-authoritative - [specification.md §5](./specification.md#5-ride-state-machine)) - `rides/ride-state-machine.ts`'s `RIDE_TRANSITIONS` + `applyRideTransition`, one atomic conditional-`UPDATE` primitive every transition in the system goes through
* [x] Nearest-available-driver matching - plain-SQL Haversine over a new `drivers.current_latitude/longitude` snapshot, **not** a PostGIS distance query (no PostGIS available - see [docs/open-items.md](./open-items.md) #1/#2; campus-geofence filtering is correspondingly skipped, #10)
* [x] `ride_offers` table + per-driver notify/accept/reject/expire cascade, offer timeout as a BullMQ delayed job ([architecture.md §4.2](./architecture.md#42-dispatch--matching)) - `dispatch/dispatch.service.ts`, `dispatch/ride-offer-timeout.processor.ts`
* [x] Atomic accept/assign via conditional `UPDATE ... WHERE status = 'SEARCHING_DRIVER'` (not a Redis lock) - `dispatch/assignment.service.ts`, extended with matching conditional claims on the driver/vehicle rows too (so the same driver can't win two concurrent rides), verified with real concurrency-race integration tests
* [x] `outbox_events` table + transactional outbox writer, written in the same transaction as every ride-state change ([architecture.md §4.3](./architecture.md#43-events--transactional-outbox)) - `events/` module
* [x] `Idempotency-Key` support on create/accept/cancel/start/complete ([architecture.md §6.2](./architecture.md#62-idempotency)) - `common/interceptors/idempotency.interceptor.ts`
* [x] Accept/reject/cancel endpoints; `ride_events` audit writes
* [x] Automated tests for every state transition and the concurrency/failure scenarios in [specification.md §11](./specification.md#11-reliability-requirements), including a full end-to-end lifecycle test through the real public API (`test/booking-lifecycle.e2e-spec.ts`)

**Deliverable - met:** Full request → match → accept loop works end-to-end: user requests, the real dispatch cascade offers the nearest driver, driver accepts, user sees the assignment, ride progresses through arrived/start/complete and appears in history - with reliable event publishing and safe retries built in from the start, not bolted on later.

**Known gaps, deliberately deferred (see [docs/open-items.md](./open-items.md) for full reasoning on each):** no campus-geofence filtering in matching (#1/#2/#10, needs PostGIS); driver-initiated cancellation is terminal rather than re-dispatching per specification.md §8's friendlier behavior (#7/#13); `idempotency_keys` rows have no TTL/cleanup job yet (#16); e2e test suites leak BullMQ/ioredis connections past `app.close()` (#19, also a real shutdown-path gap worth fixing before production). None of these block Phase 5.

### Phase 5 - Real-Time Location `[BACKEND DONE - Flutter UI not started]`

* [x] WebSocket gateway (`/ws`), JWT-authenticated handshake, per-user/per-driver room scoping, Redis-backed Socket.IO adapter for multi-pod fan-out - `locations/location.gateway.ts`, `locations/redis-io.adapter.ts`
* [x] Events module's outbox publisher ([architecture.md §4.3](./architecture.md#43-events--transactional-outbox)) feeding the WebSocket gateway - `events/consumers/domain-event-realtime.consumer.ts` consumes `domain-events` and forwards `Ride*` transitions to the right room, per a named routing table (closes [docs/open-items.md](./open-items.md) #3)
* [x] Driver location push pipeline (Flutter → gateway → Redis → WebSocket → User app) - `locations/location-cache.service.ts` (Redis, accuracy-filtered per [specification.md §6](./specification.md#6-location--accuracy-rules)) + `LocationGateway`'s `driver.location`/`DriverLocationUpdated` handler. Dispatch matching still reads the DB snapshot, not Redis - see [docs/open-items.md](./open-items.md) #26 for why a `GEOADD`-based rewrite would be needed to switch that, not a quick swap
* [ ] Live tracking UI in both Flutter apps - **not started**, out of backend scope
* Resolve the location-retention open decision (§1) - still open; Redis's 45s TTL cache is the only location persistence today, no `driver_locations` table added (none needed yet)
* [x] REST-based resync on reconnect ([specification.md §11.2](./specification.md#112-failure-scenarios)) - verified end-to-end: a disconnected client's ride progresses correctly over REST alone, and a reconnecting socket gets a `RideSync` snapshot reflecting the caught-up state (`locations/location.gateway.ts`)

**Deliverable - met on the backend:** driver movement and ride-lifecycle events reach the assigned user in near real time over `/ws`, and a client that misses events while disconnected recovers correct state on reconnect, whether or not the sync push itself arrives. **Not met yet:** nothing renders this in the Flutter apps - that's the remaining work before this phase's deliverable is user-visible, not just API-complete.

**Known gaps, deliberately deferred (see [docs/open-items.md](./open-items.md) for full reasoning):** no enforced one-active-ride-per-user constraint (#28); dispatch matching not switched to Redis (#26); e2e suites leak BullMQ/ioredis connections on shutdown (#19) and intermittently flake under full-suite parallelism due to shared-Postgres contention (#12/#17/#18/#30) - pre-existing, not Phase-5-specific, worth a systematic fix before adding many more e2e suites in later phases.

### Phase 6 - Navigation `[PARTIALLY STARTED]`

Backend routing (`GET /api/v1/maps/route` + Valhalla) was pulled forward into Phase 3 and is done. Remaining, Flutter-side:

* In-app turn-by-turn UI: route line, pickup/destination/vehicle markers with custom icons, heading-based map rotation, distance-to-maneuver, ETA, route progress
* Voice guidance (`flutter_tts`) driven by Valhalla's maneuver narrative
* Off-route detection and automatic rerouting

**Deliverable:** Driver gets full turn-by-turn guidance (visual + voice) to pickup and to destination, with automatic rerouting on deviation - see [specification.md §3.4](./specification.md#34-navigation--map-user--driver-apps) for the full feature list.

### Phase 7 - Notifications `[BACKEND DONE - unverified against a real device]`

* [x] BullMQ-backed notification queue, consuming from the Phase 4 outbox publisher - the outbox publisher now fans out to **two** queues (`domain-events` for Phase 5's WebSocket forwarding, `notification-events` for this phase), since a BullMQ queue is a work queue, not pub/sub - a second consumer on the same queue would have stolen jobs rather than duplicating them. See [docs/open-items.md](./open-items.md) #31.
* [x] Push notifications (FCM only - not a separate APNs integration; FCM already bridges to APNs for iOS, see #34) for background/killed-app states, covering: ride accepted/assigned, driver arriving/arrived, ride started/completed, cancellations. Device token registration at `POST/DELETE /api/v1/notifications/device-tokens`. Push routing deliberately differs from the WS routing table where a push would be redundant noise (e.g. `RideAssigned` pushes only the rider, not the driver who just tapped accept) - see #32.

**Deliverable - met on the backend, unverified end-to-end:** every event in the list above reaches `admin.messaging().send()` with the right recipient/token when one is registered. **What's not verified:** no real push has reached, or can reach, a real device in this sandbox - there is no Firebase project configured here (see [docs/open-items.md](./open-items.md) #36). The Flutter-side "receive a push, deep-link into the right screen" half is also not started, same as Phase 5/6's Flutter gaps.

**Known gaps/housekeeping (see [docs/open-items.md](./open-items.md)):** no real-device verification possible here (#36); `apps/api/jest.config.js` is now pinned to `maxWorkers: 1` because the growing pile of real-Postgres/Redis e2e suites across Phases 4/5/7 made default parallel test runs unreliable (#30/#37, fixed in review) - a real per-worker DB/Redis isolation fix is still the better long-term answer if the suite keeps growing.

### Phase 8 - Admin Operations `[PARTIALLY STARTED]`

Admin app already has Drivers/Vehicles/CampusLocations CRUD pages; `apps/api/src/admin` backend module is still an empty scaffold.

* Full Admin surface: users, active rides, ride history (drivers/vehicles/campus locations already shipped)
* Operational dashboard (live counts + campus map overlay - [specification.md §9](./specification.md#9-operational-dashboard-admin))

**Deliverable:** Operations team has a working live view and historical audit trail.

### Phase 9 - Hardening `[NOT STARTED]`

* Observability: metrics (including `outbox_pending_events`/`outbox_publish_failures_total` - [architecture.md §10](./architecture.md#10-observability)), health checks, error tracking wired to the dashboards operations will actually use
* Offline/reconnection hardening (driver app network loss - [specification.md §8](./specification.md#8-error--edge-case-handling))
* Security review: token rotation, rate limiting, WebSocket auth, audit logging coverage
* Load/concurrency tests for the double-accept and duplicate-request scenarios in [specification.md §11.2](./specification.md#112-failure-scenarios)

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

## 4. Immediate Next Steps

Phases 4, 5 (backend), and 7 (backend) are all done (§0/§2 above). Given §0, the next unit of work is one of:

1. **The Flutter-side halves of Phases 5/6/7**: live tracking UI, turn-by-turn navigation, and receiving/deep-linking push notifications. All need Flutter tooling, not available in this sandbox (see [docs/open-items.md](./open-items.md) #1 for the same class of environment gap) - a session with that tooling should pick these up.
2. **Phase 8 (Admin Operations)**: the Admin **React** app already exists and runs (Drivers/Vehicles/CampusLocations pages) - no Flutter needed. What's missing is backend: `admin/admin.module.ts` is still an empty scaffold, so there's no live-ops dashboard API (active rides list, driver/vehicle availability counts, ride history/search) for that app to consume. Buildable in this sandbox.
3. **Phase 9 (Hardening)**: metrics, more complete health checks, and the BullMQ/ioredis graceful-shutdown gap ([docs/open-items.md](./open-items.md) #19) - flagged as a real production concern, not just test noise, since the same leak would apply to a real shutdown signal. Also buildable here.
4. **Housekeeping**: the e2e test-isolation fix landed this session (`maxWorkers: 1`, #30/#37) is a stopgap, not the long-term answer (#30's own suggestion: per-worker DB/Redis isolation) if the suite keeps growing through Phase 8/9's own new tests.
