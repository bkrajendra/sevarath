# SevaRath - Functional & Non-Functional Specification

> Back to [README](../README.md) · See also [Architecture & Design](./architecture.md) · [Implementation Plan](./plan.md)

## 1. Overview

SevaRath is an internal EV transportation booking system for the Shantivan / Brahma Kumaris headquarters campus. It provides an Uber-like request → match → ride workflow for campus EVs, with **no payment, fare, surge, or commercial transaction logic**.

This document defines *what* the system must do and the domain rules it must enforce. For *how* it is built (stack, modules, APIs, infra), see [architecture.md](./architecture.md).

## 2. Actors & Roles

| Role | Description |
|---|---|
| `USER` | Campus resident/visitor requesting a ride |
| `DRIVER` | Approved operator of a campus EV |
| `ADMIN` | Manages drivers, vehicles, users, and operations |
| `OPERATOR` | Lightweight operational role (dispatch oversight, no full admin rights) |

Role-based access control (RBAC) applies to every API and WebSocket channel - see [architecture.md §8 Security & Identity](./architecture.md#8-security--identity).

## 3. Functional Requirements

### 3.1 User

1. Sign in (OTP or SSO per [architecture.md §8](./architecture.md#8-security--identity))
2. View current GPS location
3. Select pickup - current GPS, map tap, or a predefined campus location
4. Select destination - same options
5. Request an EV (`POST /api/v1/rides`)
6. View live request status (`SEARCHING_DRIVER` → `DRIVER_ASSIGNED` → …)
7. View assigned vehicle/driver details
8. Track the EV live on a map
9. View route/ETA to pickup, then to destination
10. Cancel the request while permitted by ride state
11. Mark trip complete (system-confirmed, not client-asserted)
12. View ride history

### 3.2 Driver

1. Sign in
2. Toggle online/offline (`AVAILABLE` ⇄ `OFFLINE`)
3. Share current location at a tunable interval (see §6)
4. Receive ride requests with a bounded response window (default 15s)
5. Accept/reject a request
6. Navigate to pickup
7. Mark arrived, then start ride
8. Navigate to destination
9. Complete ride
10. View ride history

### 3.3 Admin / Operator

* Driver management (create, approve, suspend)
* User management
* Vehicle management (create, assign, retire)
* Driver ↔ vehicle assignment
* Driver availability monitoring
* Active ride monitoring
* Ride history / audit trail
* Operational dashboard (see §9)

Admin does not need to ship in the first mobile release but is part of the target architecture from day one (Admin is the first consumer of the React/shadcn frontend - see [architecture.md §7](./architecture.md#7-frontend-architecture)).

### 3.4 Navigation & Map (User & Driver apps)

Backed by the open-source MapLibre + Valhalla stack - see [architecture.md §8](./architecture.md#8-maps--navigation) for implementation detail.

1. Route line plotted on the map
2. Moving vehicle marker, driven by live location updates
3. Current GPS position of the viewing device, shown distinctly from the vehicle marker
4. Map rotation that follows vehicle heading
5. Turn-by-turn instructions (Driver app, primary; en-route display on User app)
6. Distance to next maneuver
7. ETA, recalculated as the ride progresses
8. Voice instructions for turn-by-turn guidance
9. Automatic rerouting when the driver deviates from the active route
10. Route progress (distance/percentage traveled)
11. Pickup and destination markers
12. Custom EV/organization icons for markers
13. Custom campus roads and POIs rendered as a map overlay, and routable by EVs even though they don't exist in public map data
14. Specific areas can be dynamically included/excluded from EV routing (e.g. a closed plaza or a restricted zone) without a map rebuild - see `campus_restricted_zones` in §7

## 4. Non-Goals

Deliberately excluded from the initial system - do not design around these:

* Payments, fare calculation, surge pricing, wallets
* Driver ratings, tips, promotions
* Public/self-service driver registration
* Multi-city support, customer-support marketplace
* Dynamic pricing or advanced dispatch optimization (ML-based ETA, batching, etc.)
* Building a routing/map-matching engine from scratch - use Valhalla (open-source, self-hosted) for route calculation and maneuver narrative; the apps implement only the navigation UI, voice playback, and off-route detection, not their own routing algorithm (see [architecture.md §8](./architecture.md#8-maps--navigation))

## 5. Ride State Machine

Ride state is **server-authoritative**. No client may set ride state directly; the backend validates every transition.

```text
REQUESTED
  → SEARCHING_DRIVER
  → DRIVER_ASSIGNED
  → DRIVER_EN_ROUTE_TO_PICKUP
  → DRIVER_ARRIVED
  → RIDE_STARTED
  → DRIVER_EN_ROUTE_TO_DESTINATION
  → COMPLETED
```

Terminal/alternate states:

```text
CANCELLED_BY_USER
CANCELLED_BY_DRIVER
CANCELLED_BY_SYSTEM
NO_DRIVER_AVAILABLE
```

**Invariant:** two drivers must never be assigned to the same `SEARCHING_DRIVER` ride. Assignment is a single atomic, transactional operation on the backend (see [architecture.md §4 Dispatch](./architecture.md#42-dispatch--matching) for the locking strategy).

Every transition emits a `ride_events` audit record (see §7).

## 6. Location & Accuracy Rules

* Driver apps push location updates on a tunable cadence: ~3–5s while moving, ~10–15s while stationary (tune after field testing).
* Current location is transient - it lives in the cache layer (Redis), not as a row-per-update in Postgres (see [architecture.md §9.2](./architecture.md#92-state--cache-layer)).
* Updates carry `latitude, longitude, heading, speed, accuracy, timestamp`.
* Updates with `accuracy` worse than a configurable threshold (default **100m**) are treated as low-quality and must not silently overwrite a good last-known position.
* Historical location is only persisted if there's a defined operational need (safety/incident investigation) - define retention policy before implementation; default is **no permanent raw-GPS history**.

## 7. Domain Data Model

Authoritative entities (PostgreSQL via Drizzle - see [architecture.md §5](./architecture.md#5-database-layer-drizzle-orm)):

| Entity | Purpose |
|---|---|
| `users` | Person record: name, mobile, email, role, status |
| `drivers` | Driver profile linked to a `user`, driver code, status, current vehicle |
| `vehicles` | EV record: code, registration, type, capacity, status |
| `rides` | A single ride request through completion/cancellation, with full timestamp trail |
| `ride_events` | Append-only audit log of every state transition (`RIDE_REQUESTED`, `DRIVER_ASSIGNED`, `DRIVER_REJECTED`, …) |
| `campus_locations` | Named, typed campus points (gates, buildings, EV stops, etc.) usable as pickup/destination |
| `campus_roads` | Campus-private road/path geometry not present in public OSM data - rendered as a map overlay and merged into the Valhalla routing graph so EVs can be routed over it (see [architecture.md §8.2](./architecture.md#82-custom-campus-road-network--ev-specific-routing)) |
| `campus_restricted_zones` | Polygons (+ active flag, reason) that EV routing must avoid - passed to Valhalla as `exclude_polygons` per request, toggleable without a map rebuild |

`campus_locations.type` ∈ `GATE, BUILDING, OFFICE, RESIDENCE, DINING, PARKING, EV_STOP, MEDICAL, RECEPTION, OTHER`.

Field-level schema lives in [architecture.md §5](./architecture.md#5-database-layer-drizzle-orm) as Drizzle table definitions, not duplicated here.

## 8. Error & Edge Case Handling

| Scenario | Required behavior |
|---|---|
| No driver available | Ride → `NO_DRIVER_AVAILABLE`; user sees a clear retry message |
| Driver rejects | Automatically offer to next nearest available driver |
| Driver doesn't respond in time | Timeout → move to next driver |
| User cancels | Notify assigned driver, release vehicle back to `AVAILABLE` |
| Driver cancels | Ride returns to dispatch / `SEARCHING_DRIVER` |
| Network disconnect (driver) | Keep local UI state; do not assume server-side success; sync on reconnect |
| GPS unavailable | Show explicit error; never report stale coordinates as current |

## 9. Operational Dashboard (Admin)

Minimum viable dashboard surfaces:

* Available / busy / offline EV counts
* Live campus map with EV positions
* Active requests list with current state
* Ride history / search

## 10. Success Criteria (MVP)

The first release is successful when this full workflow is reliable end-to-end:

```text
Login → select pickup/destination → request EV → nearest available driver notified
  → driver accepts → user sees driver + live position → driver arrives
  → ride starts → live tracking during ride → ride completes → appears in history
```
