# WebSocket Documentation

Transport: Socket.IO on the same HTTP server as Express.

## Authentication and tenant scoping

Connect with:

```js
io(SOCKET_URL, {
  auth: { token: '<JWT>', tenantId: '<authorized-tenant-uuid>' }
});
```

The server verifies the JWT, loads the user's membership, confirms access to the selected tenant (including checking the organization for an Org Admin), and only then joins `tenant:<tenantId>`. The client cannot send a free-form room name. REST APIs remain the only path for task/board/column mutations.

## Server-to-client events

| Event | Payload | Meaning |
|---|---|---|
| `presence:joined` | `{tenantId,userId,userName,onlineUserIds}` | This socket joined the authorized tenant |
| `presence:update` | `{tenantId,onlineUserIds}` | Online user list changed |
| `task:created` | Task object | Task created and committed |
| `task:updated` | Task object | Task update committed |
| `task:moved` | Task object | Task move committed |
| `task:deleted` | `{id,tenantId}` | Task deleted |
| `board:created` | Board with columns | Board created |
| `board:updated` | Board object | Board updated |
| `board:deleted` | `{id}` | Board deleted |
| `column:created` | Column object | Column created |
| `column:updated` | Column object | Column updated |
| `column:deleted` | `{id}` | Column deleted |

## Client-to-server events

| Event | Payload | Meaning |
|---|---|---|
| `presence:ping` | none | Optional presence/connection ping; server responds to sender with `presence:pong` |

There are deliberately no client-to-server `task:update` or `task:move` events. Mutations go through REST so authorization, validation, version checks, database transaction, and audit logging happen before a broadcast.

## Disconnect and recovery

Socket.IO attempts reconnection. On each new connection the JWT and tenant ID are validated again. The frontend listens for `connect` and refetches tenant boards, members, and activity. This authoritative fetch repairs missed events during network loss.

## Presence notes

Presence counts active socket connections per user, so multiple tabs do not make a user appear offline until the last tab disconnects. This implementation stores presence in memory and is intended for a single server process. Multi-instance deployment needs a shared adapter and shared presence store.
