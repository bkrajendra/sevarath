# SevaRath EV Cart Booking Architecture Specification

> Back to [README](../README.md) · See also [Specification](./specification.md) · [Architecture & Design](./architecture.md) · [Implementation Plan](./plan.md)

> **Reconciliation note (2026-10-07):** This document was written generically (e.g. it assumes an existing ActiveMQ/Artemis broker that this repo does not have) and uses "booking" vocabulary. It has been reconciled against the project's actual schema/code and the other three docs:
>
> - **"Booking" in this document = the existing `rides` entity/module** (not a new parallel concept). `BookingModule` → `RidesModule`, `booking.requested` → `ride.requested`, `bookings` table → `rides` table, etc. No rename of existing code is planned; read "booking" below as "ride" throughout.
> - The **Transactional Outbox pattern**, **Idempotency-Key** requirement, and the **DRIVER_NOTIFIED/EXPIRED per-driver-offer** detail in this document were genuinely missing from [architecture.md](./architecture.md) / [plan.md](./plan.md) and have now been folded into them (architecture.md §4.3, §6.2; plan.md Phase 4).
> - This repo has **no message broker** (`docker-compose.yml` only runs Postgres+PostGIS and Redis). Per §4's own fallback, the Outbox publisher uses the existing Redis/BullMQ, not ActiveMQ Artemis — see architecture.md §4.3.
> - The ride state machine already implemented in `apps/api/src/db/schema/enums.ts` (`ride_status`) is richer than §6 below (it also has `SEARCHING_DRIVER`, `DRIVER_EN_ROUTE_TO_DESTINATION`, `NO_DRIVER_AVAILABLE`, split cancellation reasons). Keep the existing enum as authoritative; treat §6 here as the simplified acceptance-flow sub-case it already covers. The DRIVER_NOTIFIED/EXPIRED cascade per driver offer is tracked at a finer grain than `rides.status` — see the new `ride_offers` table in architecture.md §5.
>
> Phase numbering in §21 below is illustrative; the authoritative, currently-tracked phase plan is [plan.md](./plan.md).

## 1. Purpose

Define the technical architecture and implementation direction for the
SevaRath internal EV-cart booking system.

The system should provide:

-   User booking from pickup to destination
-   Real-time booking notification to eligible drivers
-   Driver accept/reject flow
-   Real-time booking status updates
-   Driver location tracking during an active ride
-   Reliable recovery when mobile/WebSocket connectivity is interrupted
-   A design that can start as a modular monolith and evolve into
    services later

The system is intentionally smaller than a commercial ride-hailing
platform. Enterprise reliability patterns should be retained without
introducing unnecessary infrastructure.

------------------------------------------------------------------------

## 2. Architectural Principles

1.  **PostgreSQL is the source of truth for booking state.**
2.  **REST APIs perform commands and queries.**
3.  **WebSocket is used for real-time delivery only.**
4.  **WebSocket messages are not authoritative state.**
5.  **Booking lifecycle is implemented as an explicit state machine.**
6.  **Booking acceptance must be concurrency-safe.**
7.  **Use the Transactional Outbox pattern for reliable domain-event
    publishing.**
8.  **Mobile clients must recover state after reconnecting.**
9.  **Driver location streaming is logically separate from booking
    state.**
10. Start with a **NestJS modular monolith**. Split modules into
    services only when operationally justified.

------------------------------------------------------------------------

## 3. High-Level Architecture

``` text
                         +----------------------+
                         |      User App        |
                         +----------+-----------+
                                    |
                             HTTPS / WebSocket
                                    |
                                    v
                    +-----------------------------+
                    |      SevaRath Backend       |
                    |           NestJS            |
                    |                             |
                    |  +-----------------------+  |
                    |  | Auth                  |  |
                    |  | Users                 |  |
                    |  | Drivers               |  |
                    |  | Vehicles              |  |
                    |  | Bookings              |  |
                    |  | Dispatch              |  |
                    |  | Realtime              |  |
                    |  | Location              |  |
                    |  | Notifications         |  |
                    |  | Events / Outbox       |  |
                    |  +-----------------------+  |
                    +-------------+---------------+
                                  |
                    +-------------+-------------+
                    |                           |
                    v                           v
             +-------------+             +-------------+
             | PostgreSQL  |             | Message     |
             |             |             | Broker      |
             | Bookings    |             | / Queue     |
             | Drivers     |             |             |
             | Vehicles    |             | Domain      |
             | Outbox      |             | events      |
             +-------------+             +------+------+
                                               |
                                               v
                                      +----------------+
                                      | Event Workers  |
                                      +-------+--------+
                                              |
                                              v
                                      WebSocket Gateway
                                              |
                                  +-----------+-----------+
                                  |                       |
                                  v                       v
                           +-------------+         +-------------+
                           | Driver App  |         |  User App   |
                           +-------------+         +-------------+
```

------------------------------------------------------------------------

## 4. Recommended Technology

### Backend

-   **NestJS**
-   TypeScript
-   REST API
-   WebSocket gateway using Socket.IO or native WebSocket
-   PostgreSQL
-   PostgreSQL via Drizzle, following the project's existing ORM convention

### Messaging

Use the existing messaging infrastructure where practical.

Preferred options:

-   Existing ActiveMQ Artemis for domain/event delivery, or
-   PostgreSQL-backed worker/queue for an initial implementation if an
    additional broker is not justified

The architecture must keep event publishing behind an abstraction so the
transport can change later.

### Client

-   User mobile/web application
-   Driver mobile application
    - same codebase for user and driver app - just build config should change the build
-   Persistent authenticated WebSocket connection
-   REST API for state synchronization

### Maps / Routing

Use the project's selected campus mapping solution. For the internal
campus use case, MapLibre with a suitable routing backend is
appropriate.

------------------------------------------------------------------------

## 5. Core Backend Modules

Keep these as NestJS modules additionaly than what already exists.

``` text
api
    src/
    ├── bookings/
    ├── realtime/
    └── events/
        ├── outbox/
        └── publisher/
```

### Booking Module

Owns:

-   Booking creation
-   Booking lifecycle
-   Booking cancellation
-   Driver assignment
-   Ride start/completion
-   Booking validation

The Booking module owns the authoritative booking state.

### Dispatch Module

Responsible for:

-   Finding eligible drivers/carts
-   Selecting or notifying drivers
-   Driver timeout handling
-   Assignment strategy

Initial implementation can use a simple nearest/available-driver
strategy.

### Realtime Module

Responsible for:

-   WebSocket authentication
-   Driver/user connection registration
-   Connection lifecycle
-   Event delivery
-   Reconnection handling

It should not contain booking business rules.

### Location Module

Responsible for:

-   Current driver location
-   Location updates
-   Ride tracking
-   Optional persistence of location history

Do not make PostgreSQL writes for every GPS update unless required.

### Events Module

Responsible for:

-   Domain event definitions
-   Transactional Outbox
-   Event publishing
-   Retry handling

------------------------------------------------------------------------

## 6. Booking State Machine

Initial booking states:

``` text
REQUESTED
    |
    v
DRIVER_NOTIFIED
    |
    +-------------> EXPIRED
    |
    v
ACCEPTED
    |
    v
DRIVER_ARRIVING
    |
    v
DRIVER_ARRIVED
    |
    v
RIDE_STARTED
    |
    v
COMPLETED
```

Cancellation can occur from appropriate states:

``` text
REQUESTED        -> CANCELLED
DRIVER_NOTIFIED  -> CANCELLED
ACCEPTED         -> CANCELLED
DRIVER_ARRIVING  -> CANCELLED
DRIVER_ARRIVED   -> CANCELLED
```

Implement state transitions centrally.

Do not allow controllers or clients to directly manipulate arbitrary
status values.

Recommended implementation:

``` text
BookingStateMachine
    canTransition(from, to)
    transition(booking, command)
```

------------------------------------------------------------------------

## 7. Booking Flow

### 7.1 Create Booking

``` text
User App
   |
   | POST /bookings
   v
Booking Module
   |
   +-- validate pickup/destination
   +-- find/prepare dispatch
   +-- create booking
   +-- create outbox event
   |
   v
PostgreSQL
   |
   v
BookingRequested event
   |
   v
Event Publisher
   |
   v
Message Broker
   |
   v
Dispatch / Notification
   |
   v
Driver WebSocket
```

Booking creation and the corresponding outbox event must be committed in
the same database transaction.

------------------------------------------------------------------------

## 8. Driver Notification

Do not directly connect User App and Driver App.

Correct flow:

``` text
User
  |
  v
Booking Service
  |
  v
PostgreSQL
  |
  v
Domain Event
  |
  v
Message Broker
  |
  v
Dispatch / Notification
  |
  v
WebSocket Gateway
  |
  v
Driver
```

The WebSocket event should normally contain an identifier rather than a
complete authoritative booking object.

Example:

``` json
{
  "event": "booking.requested",
  "bookingId": "BK12345"
}
```

The driver can then retrieve the current booking:

``` http
GET /driver/bookings/BK12345
```

This keeps the backend authoritative.

------------------------------------------------------------------------

## 9. Driver Accept Flow

Driver:

``` http
POST /driver/bookings/{bookingId}/accept
```

The operation must be concurrency-safe.

Recommended database pattern:

``` sql
UPDATE bookings
SET
    driver_id = :driverId,
    status = 'ACCEPTED'
WHERE
    id = :bookingId
    AND status = 'DRIVER_NOTIFIED';
```

Only one driver should be able to successfully update the booking.

If zero rows are affected:

``` text
Booking is no longer available.
```

Return an appropriate domain error such as:

``` text
BOOKING_ALREADY_ACCEPTED
```

Do not rely on WebSocket synchronization to prevent double acceptance.

------------------------------------------------------------------------

## 10. Real-Time Communication

### REST

Use REST for authoritative operations:

``` text
POST   /bookings
GET    /bookings/{id}
POST   /bookings/{id}/cancel

GET    /driver/bookings/pending
GET    /driver/bookings/{id}
POST   /driver/bookings/{id}/accept
POST   /driver/bookings/{id}/reject

POST   /bookings/{id}/arrived
POST   /bookings/{id}/start
POST   /bookings/{id}/complete
```

Exact API naming can be refined during implementation.

### WebSocket

Use WebSocket for events such as:

``` text
booking.requested
booking.accepted
booking.cancelled
driver.arriving
driver.arrived
ride.started
ride.completed
driver.location.updated
```

WebSocket delivery should be treated as best-effort notification.

------------------------------------------------------------------------

## 11. Reconnection and State Recovery

A mobile connection can disappear at any time.

On WebSocket reconnect:

``` text
Driver App
   |
   +-- reconnect WebSocket
   |
   +-- GET /driver/bookings/pending
   |
   +-- synchronize local state
   |
   +-- resume WebSocket event delivery
```

For the user:

``` text
User App
   |
   +-- reconnect
   |
   +-- GET /bookings/{id}
   |
   +-- synchronize current state
```

The application must remain correct even if a WebSocket event was
missed.

------------------------------------------------------------------------

## 12. Transactional Outbox

Use an Outbox table similar to:

``` text
outbox_events
--------------
id
event_type
aggregate_type
aggregate_id
payload
created_at
published_at
retry_count
last_error
```

Example transaction:

``` text
BEGIN

INSERT booking

INSERT outbox_event (
    event_type = 'BookingRequested',
    aggregate_id = booking.id
)

COMMIT
```

A publisher/worker then:

``` text
outbox_events
     |
     +-- unpublished event
     |
     v
Message Broker
     |
     v
published_at = timestamp
```

Failed publishing must be retryable.

------------------------------------------------------------------------

## 13. Domain Events

Initial events:

``` text
BookingRequested
BookingDriverNotified
BookingAccepted
BookingRejected
BookingCancelled
DriverArrived
RideStarted
RideCompleted
```

Location updates do not necessarily need to go through the durable
domain-event pipeline. Treat high-frequency GPS updates separately.

Event payloads should contain:

-   Event ID
-   Event type
-   Aggregate ID
-   Occurred timestamp
-   Correlation ID
-   Minimal event data

Example:

``` json
{
  "eventId": "evt-123",
  "eventType": "BookingAccepted",
  "aggregateId": "BK12345",
  "occurredAt": "2026-10-07T10:30:00Z",
  "correlationId": "req-456",
  "data": {
    "driverId": "DRV123"
  }
}
```

------------------------------------------------------------------------

## 14. Location Tracking

During an active ride:

``` text
Driver GPS
    |
    v
WebSocket
    |
    v
Realtime Gateway
    |
    +----> User App
    |
    +----> Location Module
```

Do not route every GPS update through the durable booking-event system.

Recommended initial frequency:

``` text
2-5 seconds
```

Tune based on battery usage, network quality and UI requirements.

Persist only what is required for:

-   Current driver location
-   Operational visibility
-   Optional trip history
-   Audit requirements

------------------------------------------------------------------------

## 15. Driver Availability

Maintain driver/cart operational state separately from booking state.

Example:

``` text
AVAILABLE
BUSY
OFFLINE
PAUSED
```

A driver should only receive booking requests when:

``` text
driver.status = AVAILABLE
```

and the associated EV cart is operational.

Later, dispatch can consider:

``` text
distance
availability
vehicle status
driver shift
current booking
campus zone
```

------------------------------------------------------------------------

## 16. Suggested Database Entities

Minimum entities:

``` text
users
drivers
vehicles
bookings
booking_events
driver_sessions
driver_locations
outbox_events
```

Potential booking fields:

``` text
bookings
--------
id
user_id
driver_id
vehicle_id
pickup_location_id / coordinates
destination_location_id / coordinates
status
requested_at
accepted_at
started_at
completed_at
cancelled_at
cancel_reason
created_at
updated_at
```

Use immutable event/audit records where operational history is required.

------------------------------------------------------------------------

## 17. Idempotency

Commands that can be retried by mobile clients should support
idempotency.

Particularly:

``` text
Create booking
Accept booking
Cancel booking
Start ride
Complete ride
```

Example:

``` http
Idempotency-Key: 7c4c1b...
```

The backend should prevent duplicate booking creation if the same
request is retried.

------------------------------------------------------------------------

## 18. Authentication and Authorization

Use the project's existing authentication solution.

At minimum:

``` text
USER
DRIVER
ADMIN / OPERATOR
```

Authorization must be enforced server-side.

Examples:

-   User can access their own bookings.
-   Driver can access bookings assigned/notified to them.
-   Driver can change state only through permitted transitions.
-   Admin/operator can view operational bookings and driver status.

Never rely on the client to enforce these rules.

------------------------------------------------------------------------

## 19. Observability

Add structured logging with:

``` text
requestId
correlationId
bookingId
userId
driverId
eventId
```

Metrics should initially include:

``` text
booking_created_total
booking_accepted_total
booking_cancelled_total
booking_completed_total

booking_acceptance_duration
booking_completion_duration

websocket_connections
websocket_disconnects

outbox_pending_events
outbox_publish_failures
```

This will make operational troubleshooting significantly easier.

------------------------------------------------------------------------

## 20. Failure Scenarios to Handle

The implementation should explicitly test:

### Driver loses network

``` text
Booking remains in PostgreSQL.
Driver reconnects.
Pending booking is recovered.
```

### User loses network

``` text
Booking continues.
User reconnects.
Current booking state is fetched.
```

### WebSocket server restarts

``` text
Clients reconnect.
State is synchronized using REST.
```

### Event broker unavailable

``` text
Booking transaction still succeeds.
Outbox event remains pending.
Publisher retries later.
```

### Two drivers accept simultaneously

``` text
Exactly one driver succeeds.
Other driver receives BOOKING_ALREADY_ACCEPTED.
```

### User submits booking twice

``` text
Idempotency prevents duplicate booking.
```

### Notification fails

``` text
Booking remains persisted.
Pending/eligible driver state remains recoverable.
```

------------------------------------------------------------------------

# 21. Phase-Wise Implementation

The coding agent should create a detailed implementation plan from these
phases.

## Phase 1 - Domain and Database

Implement:

-   Booking entity
-   Driver entity
-   Vehicle entity
-   Booking status enum/state machine
-   Database migrations
-   Basic repository/service layer
-   Booking CRUD/query APIs

Deliverable:

``` text
A booking can be created and queried with correct state transitions.
```

------------------------------------------------------------------------

## Phase 2 - Driver Assignment

Implement:

-   Driver availability
-   Vehicle availability
-   Basic dispatch strategy
-   Driver pending-booking APIs
-   Concurrency-safe accept/reject
-   Booking timeout/expiration

Deliverable:

``` text
A user can request a ride and an available driver can accept it safely.
```

------------------------------------------------------------------------

## Phase 3 - Real-Time Communication

Implement:

-   WebSocket authentication
-   User sessions
-   Driver sessions
-   Booking WebSocket events
-   Connection/reconnection handling
-   REST-based state synchronization

Deliverable:

``` text
Driver receives new booking notification in real time.
User receives booking status changes in real time.
```

------------------------------------------------------------------------

## Phase 4 - Transactional Outbox and Events

Implement:

-   outbox_events table
-   Outbox transaction integration
-   Event publisher
-   Retry mechanism
-   Domain event contracts
-   Broker integration

Deliverable:

``` text
Booking state changes reliably generate events without losing events during failures.
```

------------------------------------------------------------------------

## Phase 5 - Ride Lifecycle

Implement:

``` text
DRIVER_ARRIVING
DRIVER_ARRIVED
RIDE_STARTED
COMPLETED
CANCELLED
```

Add:

-   Driver actions
-   User status updates
-   Audit history
-   Operational APIs

Deliverable:

``` text
Complete end-to-end booking-to-ride lifecycle.
```

------------------------------------------------------------------------

## Phase 6 - Live Location

Implement:

-   Driver GPS updates
-   Realtime location events
-   User map tracking
-   Current location persistence
-   Location throttling/rate control

Deliverable:

``` text
User can see the assigned EV cart moving in real time.
```

------------------------------------------------------------------------

## Phase 7 - Reliability and Production Hardening

Implement:

-   Idempotency
-   Retry policies
-   WebSocket reconnection
-   Authentication/authorization hardening
-   Structured logging
-   Metrics
-   Health checks
-   Error handling
-   Load/concurrency tests
-   Failure scenario tests

Deliverable:

``` text
System remains consistent during retries, disconnects,
server restarts and concurrent driver actions.
```

------------------------------------------------------------------------

# 22. Recommended Initial Deployment

Do not start with many independently deployed microservices.

Initial deployment:

``` text
                    +------------------+
                    |  SevaRath API    |
                    |     NestJS       |
                    |                  |
                    | REST + WebSocket |
                    | Modules + Worker |
                    +--------+---------+
                             |
                 +-----------+-----------+
                 |                       |
                 v                       v
          +-------------+         +-------------+
          | PostgreSQL  |         | Message     |
          |             |         | Broker      |
          +-------------+         +-------------+
```

The NestJS application can contain:

``` text
Booking Module
Dispatch Module
Realtime Module
Location Module
Notification Module
Events Module
```

Split these into independent services only when there is a real
operational or scaling reason.

------------------------------------------------------------------------

# 23. Coding Agent Guidance

The coding agent should:

1.  Inspect the existing SevaRath repository before implementation.
2.  Reuse existing authentication, PostgreSQL, Docker and configuration
    patterns.
3.  Follow existing project conventions rather than introducing
    competing frameworks.
4.  Implement the booking state machine before adding UI workflows.
5.  Keep business logic out of WebSocket handlers.
6.  Keep WebSocket events small and versionable.
7.  Use PostgreSQL transactions for booking state changes.
8.  Implement concurrency protection for driver acceptance.
9.  Add the Outbox pattern before depending on asynchronous event
    delivery.
10. Add automated tests for every state transition and failure scenario.
11. Keep broker-specific code behind an abstraction.
12. Produce a phase-by-phase implementation plan before making large
    repository changes.

------------------------------------------------------------------------

# 24. Definition of Done

The initial booking architecture is considered complete when:

-   A user can create a booking.
-   Eligible drivers receive the booking in real time.
-   Only one driver can accept a booking.
-   User receives the acceptance in real time.
-   Booking state is persisted and authoritative in PostgreSQL.
-   WebSocket disconnection does not lose booking state.
-   Reconnection restores current state.
-   Booking events are reliably published using the Outbox pattern.
-   Driver can progress the ride through the defined state machine.
-   User receives real-time ride status updates.
-   Driver location can be streamed during an active ride.
-   Duplicate mobile requests are safely handled.
-   Core booking flows have automated tests.
-   Logs and metrics allow a booking to be traced using `bookingId` and
    `correlationId`.

------------------------------------------------------------------------

# 25. Architectural Decision Summary

  Concern                     Decision
  --------------------------- ---------------------------------------------------
  Backend                     NestJS
  Primary database            PostgreSQL
  Booking source of truth     PostgreSQL
  API                         REST
  Real-time communication     WebSocket
  Reliable event publishing   Transactional Outbox
  Messaging                   Existing broker / queue infrastructure
  Booking lifecycle           Explicit state machine
  Driver acceptance           Atomic DB transition
  Mobile recovery             REST state synchronization
  Location updates            Separate real-time stream
  Authentication              Existing project authentication
  Maps                        MapLibre + suitable routing backend
  Deployment                  Single backend + PostgreSQL + messaging initially
  Future scaling              Extract modules into services when justified
