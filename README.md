# Real-Time Collaborative Kanban Board

A multi-organization, multi-tenant Kanban application with tenant-scoped access control, task collaboration, presence, activity history, and optimistic concurrency.

## 1. Requirements implemented

This project is organized around the original JulleyOnline assignment:

- Organization → Tenant → Board hierarchy.
- CRUD endpoints for organizations, tenants, boards, columns, and tasks.
- Eight database entities: `organizations`, `tenants`, `users`, `memberships`, `boards`, `columns`, `tasks`, and `activity_logs`.
- Tenant-scoped business data and backend membership checks.
- Org Admin, Tenant Admin, and Member roles.
- React organization selector, tenant switcher, Kanban board, task details, and drag/drop.
- Socket.IO tenant rooms, live task/board/column updates, and per-tenant presence.
- Optimistic concurrency using task `version` and HTTP 409 conflicts.
- Optimistic frontend task movement with rollback/refetch on failure.
- Per-tenant presence, activity history, and task undo/redo endpoints with stale-state checks.
- Reconnection followed by a fresh authoritative board fetch.

The assignment permits WebSockets or SSE. This implementation uses Socket.IO. No optional AI service is included because it is not required by the original assignment.

## 2. Technology stack

- Frontend: React, Vite, JavaScript, Axios, Socket.IO Client.
- Drag and drop: dnd-kit pointer interactions with droppable columns and task targets.
- Backend: Node.js, Express, JavaScript.
- Database: PostgreSQL, Prisma ORM.
- Authentication: JWT and bcryptjs.
- Validation: Zod.
- Real-time: Socket.IO.

## 3. Architecture

```text
React browser
  | REST (JWT)                    | Socket.IO (JWT + tenantId)
  v                               v
Express API ------------------ Socket.IO server
  | authenticate + membership/tenant authorization
  | validation + role checks
  v
Prisma ORM
  v
PostgreSQL
  - organizations
  - tenants
  - users
  - memberships
  - boards
  - columns
  - tasks
  - activity_logs
```

A task mutation is validated by the API, committed in a database transaction, recorded in `activity_logs`, and then emitted to `tenant:<tenantId>`. Clients never send task mutations directly over sockets.

## 4. Tenancy and authorization model

- An organization owns multiple tenants.
- A tenant belongs to exactly one organization.
- Boards, columns, tasks, and activity logs contain `tenantId`.
- A membership links a user to an organization and optionally to one tenant.
- `ORG_ADMIN` may have an organization-level membership (`tenantId = null`). The registration flow also creates a tenant membership so the first tenant is immediately accessible.
- `TENANT_ADMIN` and `MEMBER` memberships are tenant-specific.
- Tenant context is checked against the authenticated user's membership on protected API requests.
- Resource lookups use the resource's stored tenant ID and verify membership; a client-provided tenant ID alone never grants access.
- Socket.IO validates the JWT and tenant membership before joining a tenant room. Clients cannot request arbitrary room joins.

The database stores `tenant_id` on each tenant-owned business table. API-level validation additionally verifies that board, column, task, assignee, and tenant relationships agree. For production hardening, add PostgreSQL row-level security and composite foreign keys for tenant-consistent references; these are not enabled by this prototype.

## 5. Roles

| Role | Intended permissions |
|---|---|
| Org Admin | Manage the organization and its tenants; full access within its tenants |
| Tenant Admin | Manage boards, columns, and memberships within the tenant; perform task operations |
| Member | View boards and create, edit, move, and delete tasks within the tenant |

The server checks roles for administrative mutations. The UI is not the security boundary.

## 6. Database design

The Prisma schema is in `backend/prisma/schema.prisma`. The ER diagram is `docs/database-erd.png`, with editable Graphviz source in `docs/database-erd.dot` and Mermaid source in `docs/ERD.md`. Run migrations to create the PostgreSQL tables. Indexes support organization membership, tenant board lookup, task ordering, and tenant activity history.

## 7. Setup

### Prerequisites

- Node.js 20 or later recommended.
- PostgreSQL 14 or later.
- npm.

### Backend

```bash
cd backend
npm install
copy .env.example .env
```

Edit `backend/.env` and set a real PostgreSQL connection string and a long random `JWT_SECRET`.

```bash
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed
npm run dev
```

The backend runs on `http://localhost:5000` by default. Check `GET http://localhost:5000/api/health`.

Seeded demonstration accounts (all use `DemoPass123!`):

| Email | Role | Scope |
|---|---|---|
| `admin@example.com` | Org Admin | ABC Technologies; Hyderabad and Bangalore |
| `hyd.admin@example.com` | Tenant Admin | ABC Technologies / Hyderabad |
| `hyd.member@example.com` | Member | ABC Technologies / Hyderabad |
| `blr.admin@example.com` | Tenant Admin | ABC Technologies / Bangalore |
| `mumbai.member@example.com` | Member | XYZ Solutions / Mumbai |

Change or remove these demo credentials before deploying anywhere public.

### Frontend

Open a second terminal:

```bash
cd frontend
npm install
copy .env.example .env
npm run dev
```

Open `http://localhost:5173`.

### Environment variables

Backend (`backend/.env`):

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection URL |
| `JWT_SECRET` | Secret used to sign JWTs; use a strong random value |
| `JWT_EXPIRES_IN` | JWT lifetime, default `1d` |
| `PORT` | API port, default `5000` |
| `CLIENT_ORIGIN` | Allowed frontend origin(s), comma-separated |

Frontend (`frontend/.env`):

| Variable | Description |
|---|---|
| `VITE_API_URL` | API base URL, default `http://localhost:5000/api` |
| `VITE_SOCKET_URL` | Socket server URL, default `http://localhost:5000` |

Never commit `.env` files or secrets.

## 8. API and WebSocket documentation

- REST API: `docs/API.md`
- WebSocket protocol: `docs/WEBSOCKETS.md`
- ER diagram: `docs/ERD.md`
- Architecture and request flow: `docs/ARCHITECTURE.md`
- Test plan and smoke test: `docs/TESTING.md`

All protected endpoints require `Authorization: Bearer <token>`. Tenant routes use the `:tenantId` path parameter. Resource routes infer the tenant from the stored resource and validate membership.

## 9. Concurrency and ordering

Each task has an integer `version`. Update and move requests must include `expectedVersion`. The database update includes both task ID and expected version; if no row matches, the server returns HTTP 409. Task moves execute at Serializable isolation and rewrite source and destination column positions in order. Clients reload authoritative board data after a conflict or reconnection.

## 10. Testing checklist

Use two browser sessions and separate test users to verify:

1. A user sees only authorized organizations and tenants.
2. A Hyderabad user cannot fetch a Bangalore task by ID.
3. A user cannot join another tenant's Socket.IO room.
4. Task create/update/move/delete events arrive in the same tenant.
5. A user in another tenant does not receive those events.
6. Two users editing the same version cause one request to receive HTTP 409.
7. Two users moving the same task do not silently overwrite a stale version.
8. A disconnected browser reconnects and fetches the current board.
9. Tenant activity history is only visible to members of that tenant.
10. Undo/redo endpoints are tested for task creation, update, move, and deletion; stale reversals should be rejected.

The original assignment does not define exact load-test targets. Do not claim production scalability without load testing and deployment hardening.

## 11. Known prototype limitations

- Undo/redo is a basic per-user, latest-task-action history and is not a full collaborative command stack. Concurrent changes can make an undo/redo inapplicable; the API returns a conflict where detected.
- The frontend uses dnd-kit pointer sensors and supports dropping on task cards or columns. A keyboard drag sensor is not included in this prototype.
- PostgreSQL RLS, refresh-token rotation, email verification, rate limiting, and composite tenant-consistent foreign keys are not configured.
- Organization/tenant deletion is destructive and cascades through related records. In production, use archival/soft-delete and explicit confirmation policies.
- Presence is in-memory per server process. A multi-instance deployment requires a shared Socket.IO adapter and shared presence store.
- The frontend is a functional prototype, not a production design system.

## 12. Trade-offs

- PostgreSQL provides relational integrity and transactional updates.
- Prisma provides typed schema-driven data access and migrations.
- Socket.IO simplifies event delivery, reconnection, and room-based broadcasting.
- Tenant-scoped rooms reduce accidental cross-tenant broadcasts; authorization is still checked server-side.
- Version numbers provide simple optimistic concurrency without requiring distributed locking.
- REST is used for state-changing operations so the server remains authoritative.
