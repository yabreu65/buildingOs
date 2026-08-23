# Recover production PostgreSQL from an exact custom dump

This procedure restores an approved PostgreSQL custom-format dump into a **separate candidate database**. It never restores over `buildingos_db`. Planning is read-only; candidate restore, name swap, and reverse are three independently approved maintenance actions.

> **Stop condition:** if any identity, checksum, TOC, free-space, maintenance, quiescence, session, validation, or health gate fails, stop. Never improvise a restore, drop a database, or continue to the next boundary.

## Boundaries at a glance

| Phase | Mutates PostgreSQL? | Approval boundary |
|---|---:|---|
| 1. Identify evidence | No | Incident owner selects exact files |
| 2. Isolated rehearsal | Only labeled non-production container | Exact rehearsal confirmation |
| 3. Production inspection and plan | No | None |
| 4. Restore candidate | Yes, separate database only | External `RESTORE_CANDIDATE` approval + exact confirmation |
| 5. Validate candidate | Candidate only | Included in candidate approval |
| 6. Swap names | Yes | New external `SWAP` approval + exact confirmation |
| 7. Health decision | Read-only checks | Incident commander decides keep or reverse |
| 8. Reverse names | Yes | New external `REVERSE_SWAP` approval + exact confirmation |

No phase authorizes a deploy, migration of `buildingos_db`, backup change, secret change, production cleanup, or direct restore over production.

## Required evidence

Prepare these outside the repository:

- the exact non-empty `*.dump` custom archive;
- its one-line checksum file: `<64 lowercase hex><two spaces><dump basename>`;
- its exact TOC captured with the target PostgreSQL image: `docker exec -i <container> pg_restore --list < exact.dump > exact.toc`;
- three executable validation hooks: schema, data, and migration state;
- the exact PostgreSQL container ID, not only its mutable name;
- candidate and rollback names tied to the incident;
- a protected location outside the repository for external approval files.

Hooks receive `RECOVERY_ACTION`, `RECOVERY_CONTAINER`, and `RECOVERY_DATABASE`. They must return zero only on a complete pass, must not expose credentials, and must not mutate `buildingos_db`. The migration hook validates migration state; it does not apply production migrations.

Allowed names:

```text
candidate: buildingos_prod00r_<incident>
rollback:  buildingos_pre_restore_<incident>
```

## Phase 1 — Capture exact identity

Record, in the incident log:

- dump path, size, SHA-256, creation time, PostgreSQL source/version, and custodian;
- checksum-file path and contents;
- TOC path and SHA-256;
- expected production container name and immutable 64-character container ID;
- required free bytes (at least dump size; normally use the script's conservative `3 × dump size` default);
- validation-hook paths and SHA-256 values;
- production, candidate, and rollback database names.

Dump, checksum, TOC, and hook inputs must be non-symlink regular files. Abort if provenance is ambiguous, the checksum filename differs, or the TOC was not captured from this exact dump with the PostgreSQL tooling used by the target container.

## Phase 2 — Rehearse in an isolated container

The rehearsal container must be non-production and carry this label:

```text
com.buildingos.recovery.environment=rehearsal
```

Run locally or in an explicitly isolated recovery environment—not production or staging:

```bash
bash scripts/rehearse-postgres-custom-recovery.sh \
  --dump /secure/recovery/exact.dump \
  --checksum /secure/recovery/exact.dump.sha256 \
  --toc /secure/recovery/exact.toc \
  --container buildingos-recovery-rehearsal \
  --expected-container-id <64-lowercase-hex-container-id> \
  --test-id incident42 \
  --schema-hook /secure/recovery/hooks/schema \
  --data-hook /secure/recovery/hooks/data \
  --migration-hook /secure/recovery/hooks/migrations \
  --confirm 'NON-PRODUCTION REHEARSAL'
```

The script may create, rename, and drop only `buildingos_restore_test_*` databases. It verifies SQL connectivity, runs all hooks, simulates the swap and reverse, and cleans up. A failed rehearsal blocks production planning.

## Phase 3 — Inspect and produce the plan

Run the production script **without** an execution option:

```bash
bash scripts/prepare-production-postgres-recovery.sh \
  --dump /secure/recovery/exact.dump \
  --checksum /secure/recovery/exact.dump.sha256 \
  --toc /secure/recovery/exact.toc \
  --container <production-postgres-container> \
  --expected-container-id <64-lowercase-hex-container-id> \
  --candidate buildingos_prod00r_incident42 \
  --rollback-database buildingos_pre_restore_incident42 \
  --schema-hook /secure/recovery/hooks/schema \
  --data-hook /secure/recovery/hooks/data \
  --migration-hook /secure/recovery/hooks/migrations
```

This performs only inspection: exact dump/checksum/TOC comparison, container identity, free space, active sessions, restore-helper and hook identity, and request identity. It prints exact approval content for all three mutation boundaries and exits before database creation, restore, rename, or drop.

Save the full plan output in the incident record. Review the reverse plan **before approving any swap**.

## Phase 4 — Enter maintenance and restore the candidate

Before requesting approval:

- [ ] Maintenance window is active and communicated.
- [ ] Application workers, schedulers, consumers, and traffic are quiesced by the responsible operator.
- [ ] Connection pools cannot reconnect.
- [ ] The script reports `active_sessions=0`.
- [ ] Candidate and rollback names do not exist.
- [ ] Rehearsal evidence and reverse plan are attached.

An authorized person—not the operator running the command—creates a protected external approval file by copying the exact `RESTORE_CANDIDATE` block from the current plan. The file must use an absolute path outside the repository, must not be a symlink, and must have mode `0400` or `0600`. Do not edit or reuse it.

```bash
bash scripts/prepare-production-postgres-recovery.sh \
  <the exact Phase 3 arguments> \
  --execute-restore-candidate \
  --approval-file /protected/approvals/restore-candidate.approval \
  --confirm 'APPROVE DATABASE RESTORE'
```

The script rechecks all immutable identities, free space, exact approval content, quiescence/session state, and database-name preconditions. Immediately before mutation it copies the approved dump, checksum, TOC, restore helper, and validation hooks into a private directory, verifies every pinned SHA-256 and the dump TOC again, and uses the immutable container ID. It then executes only those pinned inputs to create and restore the separate candidate. Production remains unchanged.

## Phase 5 — Validate the candidate

All three hooks run automatically. Preserve their output and independently review:

- **Schema:** expected tables, columns, indexes, foreign keys, constraints, extensions, ownership assumptions, and no unexpected schemas.
- **Data:** row-count/control totals, tenant isolation invariants, orphan checks, timestamps, and representative Resident and Finance records.
- **Migration state:** expected `_prisma_migrations` rows/checksums, no failed or partial migration, and compatibility with the intended application release.

Abort before swap if any result is missing, partial, unexpected, or non-zero. Keep production quiesced while the incident commander decides whether to retain the candidate for evidence. Do not drop or overwrite anything through this procedure.

## Phase 6 — Approve and execute the name swap

Re-run Phase 3 immediately before approval. A different dump, TOC, hook, container ID, name, or free-space requirement produces a different request identity and invalidates prior approval.

An authorized person creates a **new** external approval file from the exact `SWAP` block. Then run:

```bash
bash scripts/prepare-production-postgres-recovery.sh \
  <the exact Phase 3 arguments> \
  --execute-swap \
  --approval-file /protected/approvals/swap.approval \
  --confirm 'APPROVE DATABASE RESTORE'
```

The swap is one PostgreSQL transaction: block new production connections, recheck zero sessions, rename production to the rollback name, rename candidate to `buildingos_db`, keep the old database connection-disabled, and enable the recovered database. The script never drops either database.

Keep maintenance active. Do not resume writes until Phase 7 passes.

## Phase 7 — Health and business validation

Record owner, timestamp, command/query, expected result, and actual result for every check.

### Platform and observability

- [ ] PostgreSQL accepts SQL connections to `buildingos_db`; database name and server identity are correct.
- [ ] API and web health checks pass without bypassing normal routing or authentication.
- [ ] Error rate, latency, saturation, connection count, locks, replication/backup signals, logs, traces, and alerts are normal.
- [ ] No restore, schema, Prisma, authorization, tenant-isolation, or financial-consistency errors appear.

### Resident

- [ ] Authorized login and session restoration work.
- [ ] Dashboard, unit context, debt, payments, receipts, documents, communications, tickets, profile, and notifications load read-only.
- [ ] Multi-unit behavior is correct; cross-unit and cross-tenant access remain denied.

### Finance

- [ ] Settings, functional currency, exchange rates, expenses, incomes, applications, policies, funds, liquidations, balances, delinquency, payments, receipts, and reports load read-only.
- [ ] Ledger/control totals reconcile to the candidate validation evidence.
- [ ] Currency buckets are not aggregated across currencies; expense records have not become resident debt directly.

Do not create synthetic residents, charges, payments, expenses, liquidations, or other financial writes for validation.

## Phase 8 — Keep or reverse

### Keep

Only after every Phase 7 check passes may the incident commander authorize ending maintenance and gradually restoring traffic. Retain the old, connection-disabled rollback database until a separately approved retention/cleanup decision. This procedure never drops it.

### Reverse

If health fails, keep traffic quiesced. Re-run the read-only plan with the same evidence and confirm the expected post-swap names. An authorized person creates a **new** approval file from the exact `REVERSE_SWAP` block:

```bash
bash scripts/prepare-production-postgres-recovery.sh \
  <the exact Phase 3 arguments> \
  --execute-reverse \
  --approval-file /protected/approvals/reverse.approval \
  --confirm 'APPROVE DATABASE RESTORE'
```

Reverse blocks connections, rechecks zero sessions, restores the old database name in one transaction, and retains the failed recovered database under the candidate name with connections disabled. Re-run the complete Phase 7 checklist before restoring traffic.

## Abort rules

- **Before candidate restore:** stop; no database mutation occurred.
- **After candidate restore, before swap:** stop; production is unchanged. Never rename automatically.
- **During swap/reverse failure:** keep maintenance active, preserve exact PostgreSQL errors and current database names, and do not retry until the state is independently inspected and a new exact plan/approval is produced.
- **After swap health failure:** use only the separately approved reverse boundary. Never drop, overwrite, auto-restore, or apply migrations as a shortcut.
