# Test plan

## Automated smoke test

Start PostgreSQL, run migrations and seed data, then start the backend. In another terminal:

```bash
cd backend
npm run test:smoke
```

The smoke test uses Node's built-in `fetch` and checks login, organization/tenant seed data, cross-tenant task isolation, cross-organization task isolation, unauthorized tenant-board access, and stale-version rejection (HTTP 409).

Demo password for all seeded users: `DemoPass123!`

| User | Role | Scope |
|---|---|---|
| `admin@example.com` | Org Admin | ABC Technologies; Hyderabad and Bangalore |
| `hyd.admin@example.com` | Tenant Admin | ABC Technologies / Hyderabad |
| `hyd.member@example.com` | Member | ABC Technologies / Hyderabad |
| `blr.admin@example.com` | Tenant Admin | ABC Technologies / Bangalore |
| `mumbai.member@example.com` | Member | XYZ Solutions / Mumbai |

## Manual collaboration test

1. Sign in as `hyd.admin@example.com` in one browser and `hyd.member@example.com` in another.
2. Select the Hyderabad tenant and open the Website Development board in both sessions.
3. Create, edit, move, and delete tasks. Confirm the second session refreshes from the committed server state without a manual browser refresh.
4. Confirm presence indicators update when one session signs out or disconnects.
5. Sign in as `blr.admin@example.com` in a separate browser. Confirm Bangalore does not receive Hyderabad task events.
6. Attempt to request a task ID from another tenant using the Hyderabad member token. The resource endpoint should return 404.
7. Open the same task in two Hyderabad sessions. Save from the first session, then submit the stale version from the second. The second request should receive 409.
8. Disconnect one browser, make changes from the other, reconnect, and confirm the disconnected browser reloads the authoritative board.
9. Test Undo and Redo on task creation, update, move, and deletion. If a task has changed since the recorded snapshot, the API should reject an unsafe reversal rather than overwrite newer data.

## What this test plan does not prove

The smoke test is not a load test and does not prove production-scale throughput. Presence is stored in process memory, so a multi-instance deployment requires a shared Socket.IO adapter and shared presence store. Database migrations and end-to-end browser behavior must be run in the target environment before submission.
