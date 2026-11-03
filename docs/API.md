# REST API Documentation

Base URL: `http://localhost:5000/api`

Protected routes require `Authorization: Bearer <JWT>`. Tenant-scoped routes validate the authenticated user's membership. JSON request/response bodies are used unless noted.

## Authentication

| Method | Endpoint | Body | Purpose |
|---|---|---|---|
| POST | `/auth/register` | `{name,email,password,organizationName,tenantName}` | Register a user and bootstrap an organization, first tenant, and Org Admin |
| POST | `/auth/login` | `{email,password}` | Login; returns JWT and user |
| GET | `/auth/me` | — | Current user and memberships |

Passwords must be at least 8 characters during registration and are hashed with bcrypt.

## Organizations

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/organizations` | Authenticated | List organizations available through memberships |
| POST | `/organizations` | Authenticated | Create an organization; creator becomes Org Admin |
| GET | `/organizations/:organizationId` | Organization member | Read organization and its tenants |
| PUT | `/organizations/:organizationId` | Org Admin | Update organization name; body `{name}` |
| DELETE | `/organizations/:organizationId` | Org Admin | Delete organization and cascading records |

## Tenants

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/organizations/:organizationId/tenants` | Organization member | List authorized tenants in an organization |
| POST | `/organizations/:organizationId/tenants` | Org Admin | Create a tenant; body `{name}` |
| GET | `/tenants/:tenantId` | Tenant member / Org Admin | Read tenant |
| PUT | `/tenants/:tenantId` | Tenant Admin / Org Admin | Rename tenant; body `{name}` |
| DELETE | `/tenants/:tenantId` | Org Admin | Delete tenant and cascading records |
| GET | `/tenants/:tenantId/members` | Tenant member | List tenant memberships |
| POST | `/tenants/:tenantId/members` | Tenant Admin / Org Admin | Add or change membership; body `{email,role}` where role is `TENANT_ADMIN` or `MEMBER` |

A user must already have registered before being added by email.

## Boards

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/tenants/:tenantId/boards` | Tenant member | List boards with columns and tasks |
| POST | `/tenants/:tenantId/boards` | Tenant Admin / Org Admin | Create board; body `{name,description?}`; creates To Do, In Progress, Testing, Done columns |
| GET | `/boards/:boardId` | Tenant member | Read board with columns and tasks |
| PUT | `/boards/:boardId` | Tenant Admin / Org Admin | Update `{name?,description?}` |
| DELETE | `/boards/:boardId` | Tenant Admin / Org Admin | Delete board |

## Columns

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/boards/:boardId/columns` | Tenant member | List ordered columns |
| POST | `/boards/:boardId/columns` | Tenant Admin / Org Admin | Create column; body `{name}` |
| GET | `/columns/:columnId` | Tenant member | Read column |
| PUT | `/columns/:columnId` | Tenant Admin / Org Admin | Update `{name?,position?}` |
| DELETE | `/columns/:columnId` | Tenant Admin / Org Admin | Delete an empty column; non-empty columns return 409 |

## Tasks

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/tenants/:tenantId/tasks` | Tenant member | Create task; body `{boardId,columnId,title,description?,assignedTo?,priority?,dueDate?}` |
| GET | `/tenants/:tenantId/tasks` | Tenant member | List tenant tasks; optional `?boardId=` |
| GET | `/tasks/:taskId` | Resource tenant member | Read task |
| PUT | `/tasks/:taskId` | Resource tenant member | Update task; include `expectedVersion` |
| PATCH | `/tasks/:taskId/move` | Resource tenant member | Move task; body `{destinationColumnId,position,expectedVersion}` |
| DELETE | `/tasks/:taskId?version=1` | Resource tenant member | Delete task using its current version |

Task priorities: `LOW`, `MEDIUM`, `HIGH`. Assignees must be members of the task's tenant. A task's column must belong to the same board and tenant.

## Activity and undo/redo

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/tenants/:tenantId/activity` | Tenant member | Most recent 100 tenant activity records |
| POST | `/tenants/:tenantId/history/undo` | Tenant member | Undo the latest eligible task action by the current user |
| POST | `/tenants/:tenantId/history/redo` | Tenant member | Redo the latest action previously undone by the current user |

Undo/redo is a prototype history implementation; it is not a full multi-user command stack.

## Error responses

| Status | Meaning |
|---|---|
| 400 | Invalid input or invalid relationship |
| 401 | Missing/invalid/expired JWT |
| 403 | Authenticated but not authorized |
| 404 | Resource unavailable in caller's authorized scope |
| 409 | Version conflict or invalid state transition |
| 500 | Unexpected server error |

For task updates and moves, a 409 means the client should reload the latest task/board state and let the user retry or reconcile.
