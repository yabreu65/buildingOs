# Historical Finance Inventory

This isolated, read-only scanner inventories historical finance consistency. It is evidence for a separately authorized remediation phase; it never repairs, backfills, normalizes, or changes accounting data.

## Invocation boundary

Create a `ReadOnlyFinanceInventoryAdapter` with readers that use stable `(createdSequence, id)` ordering, then pass it to `HistoricalFinanceInventoryScanner`. Each reader is limited to `listPage({ cursor, limit })`; the scanner always requests at most 100 records and does not expose a mutation capability.

The local-only executable is `apps/api/scripts/reconciliation-historical-finance-inventory.ts`. It accepts `--database-batch-size N`, `--max-findings N`, `--output PATH`, and `--include-storage`, rejects non-development/test environments, emits one aggregate-only stdout summary, and writes protected receipts with `writeProtectedReceipt`. The injected `runHistoricalFinanceInventoryCli` helper deliberately rejects record-detail and repair flags.

`--include-storage` reuses the existing read-only historical object inventory scanner. When omitted, no storage configuration or scanner is created. When requested, unavailable configuration yields `SKIPPED_CONFIG_UNAVAILABLE`; a completed storage scan contributes only redacted aggregate counts; and a scanner failure yields a distinct `INCOMPLETE_OPERATIONAL_ERROR` storage aggregate with `STORAGE_SCAN_FAILED`. None of these paths emits storage configuration diagnostics, identifiers, cursors, object references, or raw provider errors to stdout.

## Result statuses

- `COMPLETE_CLEAN`: the bounded scan completed with only `SAFE` conditions.
- `COMPLETE_WITH_FINDINGS`: completed with `LEGACY_SUPPORTED` or `REPAIRABLE` findings only.
- `COMPLETE_WITH_BLOCKING_FINDINGS`: completed with an `INVALID_BLOCKING` finding or reached the 1,000-finding cap.
- `INCOMPLETE_OPERATIONAL_ERROR`: an adapter, pagination, or receipt operation failed; stdout includes only a non-sensitive error code.

Console summaries and receipts include only aggregate coverage, classification totals, page/count metadata, cap metadata, and finding-category totals. They exclude tenant identifiers, financial record identifiers, record-level amounts, cursors, raw payloads, and stack traces.

## Receipts and composition

`writeProtectedReceipt` writes a versioned `historical-finance-inventory/v1` JSON receipt through a temporary file, then atomically renames it and enforces mode `0600`.

`composeFinanceAndStorageSummaries` can place a separately produced storage aggregate next to the finance result. The two sources retain independent statuses and counts; storage-only operational failure makes the CLI non-success without altering the finance result.

The finance scanner processes one provider page at a time. It retains only ordering scalars, the current page's minimal counterpart evidence, and per-page lookup evidence; it never materializes entity datasets or builds a full-record index.
