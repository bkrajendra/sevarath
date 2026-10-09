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
| 8 - Admin Operations | **Done** | Admin dashboard, users, and rides-search pages implemented and verified live in a browser. A password-hash leak in `/users` found and fixed along the way (#45). |
| 9 - Hardening | **Backend done** | Observability (Prometheus metrics + Redis-aware health checks), rate limiting + leak audit, and refresh-token rotation/revocation all implemented and tested end-to-end (real Postgres/Redis). Offline/reconnection hardening and load/concurrency tests beyond what Phase 4/5's own integration tests already cover are not part of this - see the Phase 9 section below. |

**Bottom line:** the full booking core now works end-to-end - a user can request a ride, get matched to the nearest real driver, have it accepted, and ride it through to completion and history, all server-authoritative with reliable event publishing and safe retries. What's still greenfield: real-time delivery (no WebSocket gateway yet - clients would have to poll today), turn-by-turn navigation UI, push notifications, and the operational/hardening work. See §4 below for the reconciled next steps.

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
* [ ] Offline/reconnection hardening (driver app network loss - [specification.md §8](./specification.md#8-error--edge-case-handling)) - **not started**, blocked on Flutter tooling not available in this sandbox, same class of gap as Phases 5/6/7's own Flutter-side work.
* [ ] Load/concurrency tests for the double-accept and duplicate-request scenarios in [specification.md §11.2](./specification.md#112-failure-scenarios) beyond what Phase 4/5's own integration tests (`assignment.service.integration-spec.ts`, `rides.service.integration-spec.ts`) already cover - **not started**, no load-testing tool/data exists in this sandbox; revisit with real traffic data per #51/#57's own caveats.

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

Phases 4, 5 (backend), 7 (backend), 8, and 9 (backend) are all done (§0/§2 above) - every backend-buildable unit of work this sandbox can do without Flutter tooling or a real device/Firebase project is now complete. What's left is one of:

1. **The Flutter-side halves of Phases 5/6/7/9**: live tracking UI, turn-by-turn navigation, receiving/deep-linking push notifications, and offline/reconnection hardening in the driver app. All need Flutter tooling, not available in this sandbox (see [docs/open-items.md](./open-items.md) #1 for the same class of environment gap) - a session with that tooling should pick these up.
2. **Real-device/production verification**: no push has reached a real device (#36, no Firebase project configured here); no load-testing tool/data exists to tune the rate-limit thresholds (#51) or the refresh-token cleanup retention window (#57) against real traffic.
3. **Two human-review items from Phase 9**, worth resolving before wider rollout, not blocking further sandbox work: the reuse-detection severity tradeoff (#55) and the refresh-token migration's one-time fleet-wide re-login impact (#56).
4. **Housekeeping**: the e2e test-isolation fix (`maxWorkers: 1`, #30/#37) is a stopgap, not the long-term answer (#30's own suggestion: per-worker DB/Redis isolation) if the suite keeps growing with more tests.
5. **Phase 3/6's remaining backend gaps**: Planetiler base-map tiles and an Admin-triggered rebuild button (Phase 3's two unchecked items) are genuinely buildable here and don't need Flutter - worth a look if more sandbox-side work is wanted before switching to a Flutter-capable session.
