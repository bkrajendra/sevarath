# SevaRath - Implementation Plan

> Back to [README](../README.md) · See also [Specification](./specification.md) · [Architecture & Design](./architecture.md) · [Booking Architecture Spec](./sevarath-booking-architecture-spec.md)

## 0. Current Status (as of 2026-10-10)

Reconciled against the actual repo state, not just doc intent - verified by reading `apps/api/src`, `apps/mobile/lib`, `apps/admin/src`, `docker-compose.yml`, and (where noted) the real on-prem cluster/CI.

| Phase | Status | Notes |
|---|---|---|
| 1 - Foundation | **Done** | Auth (password + optional Firebase), JWT/RBAC guards, Swagger, structured logging base. |
| 2 - Driver & Vehicle Management | **Done** | `drivers`/`vehicles` schema + controllers/services, availability enum, Admin app bootstrap with Drivers/Vehicles pages. |
| 3 - Campus Map & Location Selection | **Mostly done** | Backend/infra verified live (campus data + Martin + Valhalla + `RoutingProvider`). Flutter UI is wired to real data end-to-end for both flavors now: rider booking (Phase 4) and, as of 2026-10-10, real driver-flavor screens (go online/offline, accept/reject, live location push) plus Android product flavors (verified via a real triggered release). Still open: Planetiler base-map tiles, an Admin-triggered rebuild button, and iOS build flavors (no Xcode available here). See checklist below. |
| 4 - Booking & Dispatch | **Done, including campus-geofence filtering and real Flutter wiring** | Full ride lifecycle, dispatch cascade (now geofence-filtered - [docs/open-items.md](./open-items.md) #10, closed 2026-10-10), atomic accept, transactional outbox, and idempotency keys - implemented and tested end-to-end (real HTTP, real Postgres/Redis), and now **deployed to production** (migration `0007`, the real campus-boundary polygon seeded from the imported campus locations). The Flutter booking flow (Confirm Ride → Finding Vehicle → Driver En Route → On The Way → Ride Details → history) is wired to this real API end-to-end - no more mock ride data anywhere in `apps/mobile`. See the Phase 4 section below and [docs/open-items.md](./open-items.md) for the handful of deliberately deferred gaps. |
| 5 - Real-Time Location | **Done** | WebSocket gateway, durable-event forwarding, live GPS pipeline, and reconnect/resync are all implemented and tested end-to-end (real Postgres/Redis/WebSocket). Both Flutter flavors now consume this for real: the rider app drives ride-status transitions and renders the assigned driver's live position on the map, and (2026-10-10) the driver app streams its own GPS position over the same pipeline whenever online/on a ride. `RideSync`-on-reconnect resumes an in-progress ride after a restart for both flavors. |
| 6 - Navigation | **Partially started** | Backend `GET /api/v1/maps/route` + Valhalla integration done (pulled forward into Phase 3). On The Way shows live position/remaining distance, but there is no real turn-by-turn UI yet (maneuver list, voice guidance, off-route rerouting) - still not started. |
| 7 - Notifications | **Backend done** | Device token registration + FCM push consumer implemented and tested (mocked Firebase - no real project configured here, so no push has been verified against a real device). See the Phase 7 section below. |
| 8 - Admin Operations | **Done** | Admin dashboard, users, and rides-search pages implemented and verified live in a browser. A password-hash leak in `/users` found and fixed along the way (#45). |
| 9 - Hardening | **Backend done** | Observability (Prometheus metrics + Redis-aware health checks), rate limiting + leak audit, and refresh-token rotation/revocation all implemented and tested end-to-end (real Postgres/Redis). A real CI gap was also found and fixed this pass: the `api` test job had no Redis service container at all, so every Redis-touching e2e suite failed/hung the first time a push actually ran the full suite in CI (#59). Offline/reconnection hardening and load/concurrency tests beyond what Phase 4/5's own integration tests already cover are not part of this - see the Phase 9 section below. |

**Bottom line:** the full booking core now works end-to-end **on both sides of the ride, not just the API** - a rider can open the app, pick a real destination, get matched to the nearest real driver (now campus-geofence-filtered), and a real driver can go online, accept the offer, push live location, and drive the ride through arrived/start/complete from their own app - all server-authoritative with reliable event publishing and safe retries, installable as two separate Android apps from one codebase. This is also the first work in this plan verified against the real production cluster (migrations applied, real campus boundary seeded, real CI green) and a real triggered release build (both APK flavors), not just a local sandbox. What's still greenfield: turn-by-turn navigation UI, iOS build flavors (no Xcode available here), receiving/deep-linking push notifications, ride ratings (no backend feature exists yet - see [docs/open-items.md](./open-items.md) #60), and the operational/hardening work. See §4 below for the reconciled next steps.

## 1. Open Decisions

Track before/at the start of the relevant phase - not blocking documentation, but should be resolved before the dependent phase begins:

| Decision | Options | Needed by |
|---|---|---|
| On-prem Kubernetes specifics | Cluster access, ingress, CI/CD deployment target | Phase 1 |
| Campus-private road data entry | How `campus_roads` geometry is authored/maintained (Admin-app editor vs. GIS import) and merged into the OSM extract before Valhalla's graph build | Phase 3 |
| Public OSM extract refresh cadence | How often the regional base extract is re-pulled (separate from the Admin-triggered campus-overlay rebuild, which fires on demand) | Phase 3 |
| Mobile OTP verification | Deferred - registration currently trusts the mobile number as entered, no SMS verification | Before production rollout |

**Decided (2026-10-08, product owner review):**
* **Campus geofence filtering (Phase 4, [open-items.md #10](./open-items.md)):** implement for real now - production's Postgres runs `postgis/postgis`, unlike the sandbox that built Phase 4 and had to skip this entirely. No longer blocked.
* **Driver-cancel re-dispatch ([open-items.md #7/#13](./open-items.md)):** stay terminal for now (today's behavior) - re-dispatch-on-driver-cancel is real product work with a large blast radius, revisit once the system is live and this is actually observed happening, not preemptively.
* **Refresh-token reuse response ([open-items.md #55](./open-items.md)):** confirmed - revoke every active session for the user on detecting a reused/revoked refresh token, not just the one chain. Today's implementation is correct as shipped, no change needed.
* **Refresh-token migration rollout timing ([open-items.md #56](./open-items.md)):** no special low-traffic deployment window needed - system has no live users/drivers yet.
* **Live-location retention:** the 45s Redis TTL cache (no persistent `driver_locations` history table) is sufficient - no change needed.
* **Valhalla costing profile for EVs:** switching to `motor_scooter` (closer real-world speed/maneuverability match for a slow campus EV cart than generic `auto`) - this is about routing/ETA quality, not money; there is no payment/pricing concept in this app (internal fleet booking, not a paid service). A possible future "energy/cost saved" ride-history feature is unrelated to Valhalla's costing model and would be its own separate analytics feature later.

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
* [x] Flutter app scaffolded (`apps/mobile`, one codebase/two flavors - `lib/main_user.dart`/`lib/main_driver.dart`) with the full User-app UI flow built against `docs/branding-ui.png`: splash, home, select destination, confirm ride (live MapLibre map), finding vehicle, driver en route, on the way, ride details, rate ride, profile.
* [x] Wire the Flutter app to apps/api - real mobile/email+password auth and real campus locations (see docs/architecture.md §9.4 for the password-vs-Firebase decision).
* [x] Wire the booking flow to the real `rides`/`dispatch`/`/ws` backend (2026-10-10, now that Phase 4/5 exist) - Confirm Ride resolves a real GPS pickup (`geolocator`) and a real selected destination, calls `POST /rides`; Finding Vehicle/Driver En Route/On The Way are pure consumers of the real ride status, kept in sync via the `/ws` gateway (`socket_io_client`, falling back to a `GET /rides/:id` re-fetch on every relevant event, per that gateway's own documented design) with live driver location on the map; Rides history and Ride Details read `GET /rides/history`/`GET /rides/:id` for real. `RideResponseDto` gained an embedded `driver`/`vehicleCode` summary (`rides.controller.ts#enrich`) since a rider has no other authorized way to learn their assigned driver's name (`GET /drivers/:id` is ADMIN-only). The straight-line route between two hardcoded points is gone - the map now draws between the real selected/live coordinates. Deliberately left out of scope, not faked: a map-tap-to-pick/custom-location pickup flow ("Additional Location" is disabled, not wired to a fake confirm-ride) and ride ratings (no backend rating table/endpoint exists at all yet - Rate Ride still collects a rating locally but is honest that it isn't persisted).
* [x] Driver-flavor-specific screens (2026-10-10) - `main_driver.dart` now boots a real `driverRouter` (`FlavorConfig.isDriver` branch in `app.dart`): `DriverHomeScreen` (go online/offline/on-break via `POST /drivers/status`, or the active-ride card once assigned), `IncomingOfferScreen` (15s-countdown accept/reject, polling `GET /dispatch/offers/me` with a `RideDriverNotified` WS hint for an instant poll), and live GPS push over the driver socket's `driver.location` event whenever online or on a ride - no backend changes were needed, every endpoint this uses already existed and was unused by any client. Blocks with a clear message rather than a wall of 403s if a non-`DRIVER` account ends up in this flavor.
* [x] Android build flavors (2026-10-10) - `productFlavors { user; driver }` in `android/app/build.gradle.kts` (distinct `applicationId`/app name, installable side by side), `mobile-release.yml` now builds and releases both APKs - verified end-to-end via a real triggered release ([v1.1.0](https://github.com/bkrajendra/sevarath/releases/tag/v1.1.0), both `SevaRath-v1.1.0.apk`/`SevaRath-Driver-v1.1.0.apk` built and published). **iOS schemes still not attempted** - no Xcode available in this environment to safely edit/verify a `.pbxproj` by hand; needs a session with real macOS/Xcode access.

**Deliverable - met:** User can see the campus map (with custom campus roads/POIs) and select pickup/destination, that selection flows into a real ride (Phase 4), and a driver can now run the other half of that ride through a real driver-flavor app. *(Still open: Planetiler base-map tiles, an Admin-triggered rebuild button, and iOS build flavors - none block booking on Android.)*

### Phase 4 - Booking & Dispatch `[DONE]`

* [x] `rides` entity, ride state machine (server-authoritative - [specification.md §5](./specification.md#5-ride-state-machine)) - `rides/ride-state-machine.ts`'s `RIDE_TRANSITIONS` + `applyRideTransition`, one atomic conditional-`UPDATE` primitive every transition in the system goes through
* [x] Nearest-available-driver matching - plain-SQL Haversine over a new `drivers.current_latitude/longitude` snapshot, **not** a PostGIS distance query (still the case - see [docs/open-items.md](./open-items.md) #2, a separate open decision from geofencing)
* [x] Campus-geofence filtering ([architecture.md §4.2](./architecture.md#42-dispatch--matching) step 3, [docs/open-items.md](./open-items.md) #10) - `campus_boundaries` table (polygon(s), same shape as `campus_restricted_zones` but for the overall campus perimeter, not routing exclusion) + an `ST_Contains` check in `driver-matcher.service.ts#findCandidates`. The filter only engages once at least one boundary row is `isActive` - with none configured it's a no-op, so a dev/CI setup without real boundary data still matches unfiltered. Production's boundary is seeded from the real imported `campus_locations` (convex hull, +60m buffer - `k8s/api/one-off-2026-10-10-seed-campus-boundary.yaml`); `db/seed.ts` does the same for fresh setups, skipped gracefully if PostGIS isn't available.
* [x] `ride_offers` table + per-driver notify/accept/reject/expire cascade, offer timeout as a BullMQ delayed job ([architecture.md §4.2](./architecture.md#42-dispatch--matching)) - `dispatch/dispatch.service.ts`, `dispatch/ride-offer-timeout.processor.ts`
* [x] Atomic accept/assign via conditional `UPDATE ... WHERE status = 'SEARCHING_DRIVER'` (not a Redis lock) - `dispatch/assignment.service.ts`, extended with matching conditional claims on the driver/vehicle rows too (so the same driver can't win two concurrent rides), verified with real concurrency-race integration tests
* [x] `outbox_events` table + transactional outbox writer, written in the same transaction as every ride-state change ([architecture.md §4.3](./architecture.md#43-events--transactional-outbox)) - `events/` module
* [x] `Idempotency-Key` support on create/accept/cancel/start/complete ([architecture.md §6.2](./architecture.md#62-idempotency)) - `common/interceptors/idempotency.interceptor.ts`
* [x] Accept/reject/cancel endpoints; `ride_events` audit writes
* [x] Automated tests for every state transition and the concurrency/failure scenarios in [specification.md §11](./specification.md#11-reliability-requirements), including a full end-to-end lifecycle test through the real public API (`test/booking-lifecycle.e2e-spec.ts`)

**Deliverable - met:** Full request → match → accept loop works end-to-end: user requests, the real dispatch cascade offers the nearest driver, driver accepts, user sees the assignment, ride progresses through arrived/start/complete and appears in history - with reliable event publishing and safe retries built in from the start, not bolted on later.

**Known gaps, deliberately deferred (see [docs/open-items.md](./open-items.md) for full reasoning on each):** nearest-driver distance is still plain-SQL Haversine, not `ST_Distance` (#2, separate decision from geofencing - still open); driver-initiated cancellation is terminal rather than re-dispatching per specification.md §8's friendlier behavior (#7/#13); `idempotency_keys` rows have no TTL/cleanup job yet (#16); e2e test suites leak BullMQ/ioredis connections past `app.close()` (#19, also a real shutdown-path gap worth fixing before production). None of these block Phase 5. **Campus-geofence filtering (#10) is now implemented - see above (2026-10-10).**

### Phase 5 - Real-Time Location `[DONE]`

* [x] WebSocket gateway (`/ws`), JWT-authenticated handshake, per-user/per-driver room scoping, Redis-backed Socket.IO adapter for multi-pod fan-out - `locations/location.gateway.ts`, `locations/redis-io.adapter.ts`
* [x] Events module's outbox publisher ([architecture.md §4.3](./architecture.md#43-events--transactional-outbox)) feeding the WebSocket gateway - `events/consumers/domain-event-realtime.consumer.ts` consumes `domain-events` and forwards `Ride*` transitions to the right room, per a named routing table (closes [docs/open-items.md](./open-items.md) #3)
* [x] Driver location push pipeline (Flutter → gateway → Redis → WebSocket → User app) - `locations/location-cache.service.ts` (Redis, accuracy-filtered per [specification.md §6](./specification.md#6-location--accuracy-rules)) + `LocationGateway`'s `driver.location`/`DriverLocationUpdated` handler. Dispatch matching still reads the DB snapshot, not Redis - see [docs/open-items.md](./open-items.md) #26 for why a `GEOADD`-based rewrite would be needed to switch that, not a quick swap
* [x] Rider-side live tracking UI (2026-10-10) - `apps/mobile`'s `RideController` connects the `/ws` gateway and renders the assigned driver's live position on the map during Driver En Route/On The Way, driven by real `DriverLocationUpdated` events (`features/ride/data/ride_socket_service.dart`, `features/ride/providers/ride_provider.dart`)
* [x] Driver-side live tracking UI (2026-10-10) - `DriverLocationPusher` (`features/driver/providers/driver_providers.dart`) streams the device's GPS position (`geolocator`, 10m distance filter) over the driver socket's `driver.location` event whenever the driver is online or on a ride. Built as part of Phase 3's driver-flavor screens, since a driver app isn't functional without it - closed here as a side effect, not a separate task.
* [x] Live-location retention - **decided** (§1, 2026-10-08): the 45s Redis TTL cache is sufficient, no persistent `driver_locations` history table needed.
* [x] REST-based resync on reconnect ([specification.md §11.2](./specification.md#112-failure-scenarios)) - verified end-to-end: a disconnected client's ride progresses correctly over REST alone, and a reconnecting socket gets a `RideSync` snapshot reflecting the caught-up state (`locations/location.gateway.ts`); the Flutter app now acts on this too (a Home-screen "resume active ride" banner for the rider, and the driver app's own `RideSync`-driven active-ride resume).

**Deliverable - met:** driver movement and ride-lifecycle events reach the assigned user in near real time over `/ws`, a client that misses events while disconnected recovers correct state on reconnect, and both the rider's and the driver's Flutter apps actually render this now (live driver position, status-driven screen transitions on the rider side; a live GPS push loop on the driver side).

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

**Deliverable - met on the backend, unverified end-to-end:** every event in the list above reaches `admin.messaging().send()` with the right recipient/token when one is registered. **What's not verified:** no real push has reached, or can reach, a real device - there is no Firebase project configured here (see [docs/open-items.md](./open-items.md) #36). The Flutter-side "receive a push, deep-link into the right screen" half is also not started.

**Known gaps/housekeeping (see [docs/open-items.md](./open-items.md)):** no real-device verification possible here (#36); `apps/api/jest.config.js` is now pinned to `maxWorkers: 1` because the growing pile of real-Postgres/Redis e2e suites across Phases 4/5/7 made default parallel test runs unreliable (#30/#37, fixed in review) - a real per-worker DB/Redis isolation fix is still the better long-term answer if the suite keeps growing.

### Phase 8 - Admin Operations `[DONE]`

* [x] Full Admin surface: users (`GET /api/v1/users`, ADMIN-only), active rides + ride history/search (`GET /api/v1/admin/rides`), drivers/vehicles/campus locations (already shipped in earlier phases)
* [x] Operational dashboard - live counts (`GET /api/v1/admin/dashboard/summary`: vehicles by status, drivers by availability, active-ride count) and campus map overlay, scoped to **data, not a rendered map** (`GET /api/v1/admin/live-map` + a table in the Admin app - no map library/tile-server path exists for the Admin React app yet, see [docs/open-items.md](./open-items.md) #38/#41)
* [x] Admin React pages: Dashboard (now the landing route), Users, Rides, all polling every 10s - built and verified live in a browser against the real API

**Deliverable - met:** Operations team has a working live view (polling, not yet WebSocket-pushed) and historical audit trail/search.

**Known gaps (see [docs/open-items.md](./open-items.md)):** no rendered map (data table instead, #38/#41); dashboard/live-map poll rather than subscribe to `/ws` (#42); a real **security fix** landed in review - `GET /users/me`/`GET /users` had been leaking every user's bcrypt `passwordHash` since Phase 1, now fixed with a regression test (#45).

### Phase 9 - Hardening `[BACKEND DONE]`

* [x] Observability: every metric [architecture.md §10](./architecture.md#10-observability) names by name is live at `GET /metrics` (Prometheus text-exposition, `prom-client`) - `ride_requests_total`, `ride_completed_total`, `ride_cancelled_total{cancelled_by}`, `ride_assignment_duration_seconds`, `active_rides`, `available_drivers`, `driver_location_updates_total{outcome}`, `websocket_connections`, `push_notifications_total{outcome}`, `outbox_pending_events`, `outbox_publish_failures_total`, `outbox_publish_latency_seconds`, plus default Node process metrics. `GET /health/ready` now checks both Postgres and Redis (503 if either is down); `/health`/`/health/live` stay dependency-free. See [docs/open-items.md](./open-items.md) #44-49.
* [x] Security review: rate limiting (`@nestjs/throttler`, global 100/min-per-IP default, stricter 5/min override on login/register/login-password, `@SkipThrottle()` on health/metrics/the WS gateway's message handler), a leak audit (found and fixed a second raw-entity leak - `device_tokens.token` echoed by `POST /notifications/device-tokens`, same bug class as #45), and a WebSocket auth hardening review (confirmed the `emitToUser`/`emitToDriver`-only invariant still holds; documented, rather than built around, a real-but-minor gap where a socket's JWT is never revalidated after the handshake). See [docs/open-items.md](./open-items.md) #50-53.
* [x] Token rotation: refresh tokens are no longer bare stateless JWTs - a new `refresh_tokens` table records every issued token (SHA-256-hashed, not bcrypt - see #54 for why), `AuthService#refresh` rotates atomically on every call, reuse of an already-revoked token is treated as a theft signal and revokes every active session for that user (#55, flagged for human review), and a new `POST /auth/logout` lets a client revoke on demand. See [docs/open-items.md](./open-items.md) #54-58.
* [x] CI gap found and fixed (2026-10-10): the `api` test job in `.github/workflows/ci.yml` had no Redis service container at all - every Redis-touching e2e suite failed/hung in CI, undetected until a normal push finally ran the full suite there for the first time. Fixed by adding a `redis:7-alpine` service, matching `docker-compose.yml`. See [docs/open-items.md](./open-items.md) #59.
* [ ] Offline/reconnection hardening (driver app network loss - [specification.md §8](./specification.md#8-error--edge-case-handling)) - **not started**. Flutter tooling is available and in active use now (the rider-side booking/live-tracking UI, Phase 3/4/5, was built with it) - this is blocked on the driver-flavor screens themselves not existing yet (Phase 3), not on tooling.
* [ ] Load/concurrency tests for the double-accept and duplicate-request scenarios in [specification.md §11.2](./specification.md#112-failure-scenarios) beyond what Phase 4/5's own integration tests (`assignment.service.integration-spec.ts`, `rides.service.integration-spec.ts`) already cover - **not started**, no load-testing tool/data exists yet; revisit with real traffic data per #51/#57's own caveats.

**Deliverable - met on the backend:** the system now has real observability, a real rate-limiting/leak-closed security posture, and real refresh-token revocation - all verified end-to-end against real Postgres/Redis, not mocked. **Not met yet:** the Flutter-side offline/reconnection hardening and any load-testing beyond this sandbox's own integration-test concurrency races.

**Two items flagged for human review before wider rollout** (see [docs/open-items.md](./open-items.md) #55/#56): whether "revoke every active session" is the right default for reuse-detection (vs. a narrower per-chain revoke), and that deploying the refresh-token migration invalidates every currently-live refresh token fleet-wide on its first use after rollout (a one-time forced re-login for every logged-in user/driver - worth a low-traffic deployment window).

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

The backend is done across every phase (§0/§2 above), and **both** Flutter flavors are now wired to it end-to-end: real auth, real campus locations, a real booking/live-tracking flow for the rider (Phase 3/4/5), and real go-online/accept-reject/live-location screens for the driver (Phase 3/5, 2026-10-10) - installable as two separate Android apps, verified via a real triggered release build. The production cluster is actually running the geofence-filtering migration and a real seeded campus boundary. What's left:

1. **Turn-by-turn navigation UI** (Phase 6) - route line, maneuver list, voice guidance, off-route rerouting, on top of the `GET /api/v1/maps/route` endpoint that already works.
2. **iOS build flavors/schemes** (Phase 3) - Android flavors are done and verified; iOS was deliberately not attempted - no Xcode available in this environment to safely edit/verify a `.pbxproj` by hand. Needs a session with real macOS/Xcode access.
3. **Receiving/deep-linking push notifications** in the Flutter app (Phase 7's remaining half) - the backend send side is done and tested; nothing in `apps/mobile` listens for a push yet.
4. **A ride-rating backend** ([docs/open-items.md](./open-items.md) #60) - `apps/mobile`'s Rate Ride screen has real UI ready but nothing to call; no `ride_ratings` table/endpoint exists anywhere today.
5. **A map-tap-to-pick location flow** (#61) - pickup/destination today must be GPS or a known `campus_locations` stop; "Additional Location" is disabled rather than faked.
6. **Real-device/production verification**: no push has reached a real device yet (#36, no Firebase project configured here); no load-testing tool/data exists to tune the rate-limit thresholds (#51) or the refresh-token cleanup retention window (#57) against real traffic, now that the system is actually live.
7. **Two human-review items from Phase 9**, worth resolving before wider rollout: the reuse-detection severity tradeoff (#55, already confirmed as-is by the product owner) and the refresh-token migration's one-time fleet-wide re-login impact (#56, already confirmed no special timing needed).
8. **Housekeeping**: the e2e test-isolation fix (`maxWorkers: 1`, #30/#37) is a stopgap, not the long-term answer (#30's own suggestion: per-worker DB/Redis isolation) if the suite keeps growing with more tests.
9. **Phase 3's remaining backend gaps**: Planetiler base-map tiles and an Admin-triggered rebuild button (Phase 3's two unchecked backend items) - small, self-contained.
