# BuildingOS Production Smoke Tests

Run these checks immediately after deployment.

## API and app

```bash
curl -i https://<api-host>/health
curl -i https://<api-host>/readyz
curl -i https://<web-host>/
```

Expected:

- `/health` returns `200`
- `/readyz` returns `200`
- web home/login responds without 5xx

## Authentication

1. Log in with an admin user.
2. Confirm tenant dashboard loads.
3. Confirm one resident user can also log in.

## Tenant and permissions

1. Open one known tenant/building.
2. Verify tenant-scoped data loads.
3. Confirm a resident cannot see another unit outside self-scope.

## Operational critical paths

1. Create a ticket.
2. Create or review one financial record in a non-production-safe sandbox tenant.
3. Upload a document metadata record or test file.
4. Verify one assistant operational query returns tenant-safe data.

## Dependency checks

1. Confirm storage writes succeed.
2. Confirm email provider is either healthy or intentionally disabled.
3. Confirm rate-limit headers are present on write requests.

## Rollback triggers

Rollback immediately if any of the following happen:

- `/readyz` returns `503`
- login fails for valid users
- tenant data appears cross-scoped
- document storage fails
- write operations return sustained 5xx
