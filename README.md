<div align="center">
  <h1><img src="docs/icon512.png" alt="" width="48" height="48" /> SevaRath</h1>
  <p><strong>Brahma Kumaris Internal EV Booking System</strong></p>
  <p>
    <a href="https://github.com/bkrajendra/sevarath/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/bkrajendra/sevarath/ci.yml?branch=main&label=CI" alt="CI status" /></a>
    <a href="https://github.com/bkrajendra/sevarath/stargazers"><img src="https://img.shields.io/github/stars/bkrajendra/sevarath?style=social" alt="GitHub stars" /></a>
    <a href="https://github.com/bkrajendra/sevarath/graphs/contributors"><img src="https://img.shields.io/github/contributors/bkrajendra/sevarath" alt="Contributors" /></a>
  </p>
  <img src="docs/repo-social-preview.png" alt="SevaRath - Your Companion for Every Journey" width="100%" />
</div>

## 1. Purpose

Build an internal EV transportation application for use within the Shantivan and nearby premises.

The application provides a simple Uber-like experience for:

* Requesting an EV ride
* Matching a request with an available driver
* Driver accepting or rejecting a request
* Real-time driver/user location
* Pickup and destination selection
* Map display
* Navigation directions
* Ride status tracking
* Ride completion
* Basic ride history

There is **no payment, fare calculation, surge pricing, wallet, or commercial transaction**.

The system is intended for controlled internal use within the headquarters premises.



---

![SevaRath - Brahma Kumaris Internal EV Booking System](docs/arch-d.png)

## 2. Product Scope

Two mobile apps and one admin console:

* **User App** - request a ride, track the assigned EV live, view history.
* **Driver App** - go online/offline, accept/reject requests, navigate, complete rides.
* **Admin** - driver/vehicle/user management, assignment, live operational dashboard, ride history.

Full user stories and functional/non-functional requirements: **[docs/specification.md](docs/specification.md)**.

## 3. Product Philosophy

Designed around the actual headquarters environment, not a reproduction of Uber. Deliberately excludes payments, fares, ratings, tips, promotions, surge pricing, public driver registration, and advanced dispatch optimization - see [docs/specification.md §4](docs/specification.md#4-non-goals) for the full non-goals list.

Primary workflow:

```text
User -> Request EV -> Find Available Driver -> Driver Accepts
     -> Ride Assigned -> Navigate to Pickup -> Ride Started
     -> Navigate to Destination -> Ride Completed
```

## 4. Architecture at a Glance

Modular NestJS monolith (not microservices) backing a React Admin console and Flutter User/Driver apps, with PostgreSQL as business truth and Redis for real-time/transient state.

```text
     Flutter Apps (User/Driver)        Admin (React + shadcn/ui)
              |                                  |
              +---------------+------------------+
                              |
                         NestJS API (OpenAPI v1)
                       Auth / Rides / Dispatch / ...
                         /                    \
                        v                      v
               PostgreSQL + PostGIS          Redis
               (Drizzle ORM)          (cache, presence, BullMQ)
```

Full technical design (modules, API/versioning, WebSocket events, data model, security): **[docs/architecture.md](docs/architecture.md)**.

## 5. Target Tech Stack

| Layer | Choice |
|---|---|
| Backend | NestJS + Drizzle ORM (PostgreSQL + PostGIS) |
| Real-time / cache / queue | Redis + BullMQ |
| Admin frontend | React + Tailwind CSS + shadcn/ui + Base Web |
| User / Driver apps | Flutter |
| Maps & navigation | MapLibre GL (Flutter) + self-hosted OpenMapTiles/Martin tiles + Valhalla routing - all open-source |
| API | REST, OpenAPI 3.1, versioned (`/api/v1`) |
| Identity | NestJS Passport - Google OAuth (SSO) + Mobile OTP |
| Deployment | Docker on on-prem Kubernetes |

Details and rationale: **[docs/architecture.md §1](docs/architecture.md#1-tech-stack)**. Admin coding conventions: **[docs/frontend-guidelines.md](docs/frontend-guidelines.md)**.

## 6. Infrastructure Topology

1. **Application Layer** - NestJS deployed inside Docker containers on on-prem Kubernetes.
2. **State & Cache Layer** - Redis handles NestJS BullMQ queues for automated release actions and caches fast-changing availability grids.
3. **Storage Layer** - PostgreSQL coupled with Drizzle for strict ACID compliance.
4. **Identity Layer** - NestJS Passport hooks connect directly to SSO (Google OAuth) and mobile OTP.
5. **Maps & Navigation Layer** - self-hosted, open-source tile server (Martin/TileServer GL) and Valhalla routing engine, no commercial map API dependency.

Full diagram and per-layer detail: **[docs/architecture.md §9](docs/architecture.md#9-infrastructure-topology)**.

## 7. Repository Layout

This is a **pnpm workspace monorepo** (see `pnpm-workspace.yaml`):

```text
apps/
  api/      NestJS backend (Drizzle ORM, PostgreSQL+PostGIS, Redis, Firebase auth)
  admin/    React + Tailwind + shadcn/ui + Base Web admin console (Vite)
docs/       specification.md, architecture.md, frontend-guidelines.md, plan.md
k8s/        Kubernetes manifests for the sevarath namespace - see k8s/README.md
```

## 8. Running Locally

Requires Node 22+ and `pnpm` (`corepack enable` picks up the pinned version from `package.json`).

```bash
pnpm install                       # installs both apps/api and apps/admin
docker compose up -d               # Postgres+PostGIS on :5433, Redis on :6380

cp apps/api/.env.example apps/api/.env       # fill in Firebase service account - see §5
cp apps/admin/.env.example apps/admin/.env   # fill in Firebase web config - see §5

pnpm api:db:migrate
pnpm api:dev                       # http://localhost:3000, OpenAPI docs at /api-docs
pnpm admin:dev                     # http://localhost:5173 (proxies /api -> :3000)
```

Host ports are remapped (5433/6380) to avoid clashing with any pre-existing local Postgres/Redis. Without Firebase configured, both apps still run: the API's `/auth/login` returns `503` instead of crashing, and the Admin app's sign-in button shows a clear "not configured" message instead of a blank page.

Other workspace-wide commands: `pnpm --filter @sevarath/api <script>` / `pnpm --filter @sevarath/admin <script>` run any script from that app's `package.json` (e.g. `pnpm --filter @sevarath/admin gen:api-types` regenerates the Admin app's OpenAPI-derived types from a running API — see [docs/frontend-guidelines.md](docs/frontend-guidelines.md)).

## 9. Docker & Kubernetes

Both apps have a multi-stage `Dockerfile` (`apps/api/Dockerfile`, `apps/admin/Dockerfile`) built from the **repo root** as context (`docker build -f apps/api/Dockerfile .`), since pnpm needs the full workspace manifest to install deterministically. `.github/workflows/docker-publish.yml` builds and pushes both images to `ghcr.io/<owner>/sevarath-{api,admin}` on every push (`:latest` on `main`). `.github/workflows/ci.yml` runs a build check on PRs to `main`.

Kubernetes manifests for the `sevarath` namespace (API, Postgres+PostGIS, Redis, Admin, Ingress) live in **[k8s/](k8s/README.md)**, including deploy order and secret setup.

## 10. Documentation Index

| Doc | Covers |
|---|---|
| [docs/specification.md](docs/specification.md) | Actors, functional/non-functional requirements, ride state machine, data model, success criteria |
| [docs/architecture.md](docs/architecture.md) | Tech stack, system & module architecture, API/versioning, WebSocket design, security, infrastructure topology, observability |
| [docs/frontend-guidelines.md](docs/frontend-guidelines.md) | Admin app (React/Tailwind/shadcn/baseui) component and state-management conventions |
| [docs/plan.md](docs/plan.md) | Phased delivery plan, deliverables per phase, open decisions |
| [k8s/README.md](k8s/README.md) | Kubernetes deploy order, secrets, image registry |

## 11. MVP Success Criteria

The first release is successful when this full workflow is reliable end-to-end: login → select pickup/destination → request EV → nearest driver notified → accepts → live tracking → ride completes → appears in history. See **[docs/specification.md §10](docs/specification.md#10-success-criteria-mvp)**.
