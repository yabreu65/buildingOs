#!/usr/bin/env bash
set -euo pipefail

npm exec --workspace apps/api -- ts-node --project tsconfig.staging-seed.json -e "import { selectStagingGoldenDataset } from './prisma/lib/staging-seed/staging-golden-seed'; const selected = selectStagingGoldenDataset({ STAGING_GOLDEN_TENANTS: 'stg-golden-tenant-auto' }); if (selected.length !== 1 || selected[0]?.id !== 'stg-golden-tenant-auto') process.exit(1); for (const id of ['stg-golden-tenant-multi', 'stg-golden-tenant-edge', 'tenant-real-customer', 'stg-golden-tenant-unknown']) { let rejected = false; try { selectStagingGoldenDataset({ STAGING_GOLDEN_TENANTS: id }); } catch { rejected = true; } if (!rejected) throw new Error('unexpectedly selected tenant: ' + id); } console.log('PASS: only stg-golden-tenant-auto is selectable');"
