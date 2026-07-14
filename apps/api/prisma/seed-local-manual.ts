import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import {
  applyLocalManualSeed,
  assertSafeLocalSeedEnvironment,
  inspectLocalManualSeed,
  LOCAL_MANUAL_SEED,
  readApplyCredentials,
  readSeedEmails,
} from './lib/local-seed/local-manual-seed';

function hasApplyFlag(args: readonly string[]): boolean {
  return args.includes('--apply');
}

function countByMode(records: readonly { readonly created: boolean }[]): { created: number; reused: number } {
  const created = records.filter((record) => record.created).length;
  return { created, reused: records.length - created };
}

async function main(): Promise<void> {
  const apply = hasApplyFlag(process.argv.slice(2));
  const target = assertSafeLocalSeedEnvironment(process.env);
  const emails = readSeedEmails(process.env);
  const credentials = apply ? readApplyCredentials(process.env) : undefined;

  const prisma = new PrismaClient();

  try {
    if (!apply) {
      const inspection = await inspectLocalManualSeed(prisma, target, emails);
      console.log('Local manual seed diagnostic');
      console.log(`Target database: ${inspection.connection.database}`);
      console.log(`Target host: ${target.host}`);
      console.log(`Tenant type: ADMINISTRADORA`);
      console.log('Management mode: not supported by the current Tenant model');
      console.log(`Existing plan/tenant/building/units/users: ${inspection.existing.plan}/${inspection.existing.tenant}/${inspection.existing.building}/${inspection.existing.units}/${inspection.existing.users}`);
      console.log(`Will prepare: ${LOCAL_MANUAL_SEED.tenantName}, ${LOCAL_MANUAL_SEED.buildingName}, ${LOCAL_MANUAL_SEED.units.length} units, 1 administrator, 2 residents`);
      console.log('No data was written. Re-run with --apply after providing all LOCAL_SEED_* email and password variables.');
      return;
    }

    if (!credentials) {
      throw new Error('Apply credentials are required before connecting to PostgreSQL');
    }
    const result = await applyLocalManualSeed(prisma, target, credentials);
    const units = countByMode(result.units);
    const users = countByMode(result.users);
    const memberships = countByMode(result.memberships);
    const tenantMembers = countByMode(result.tenantMembers);
    const occupancies = countByMode(result.occupancies);

    console.log('Local manual seed applied');
    console.log(`Target database: ${result.target.database}`);
    console.log('Tenant type: ADMINISTRADORA');
    console.log('Management mode: not supported by the current Tenant model');
    console.log(`Tenant: ${result.tenant.created ? 'created' : 'reused'}`);
    console.log(`Building: ${result.building.created ? 'created' : 'reused'}`);
    console.log(`Units: created=${units.created}, reused=${units.reused}`);
    console.log(`Users: created=${users.created}, reused=${users.reused}`);
    console.log(`Memberships: created=${memberships.created}, reused=${memberships.reused}`);
    console.log(`TenantMembers: created=${tenantMembers.created}, reused=${tenantMembers.reused}`);
    console.log(`UnitOccupants: created=${occupancies.created}, reused=${occupancies.reused}`);
    console.log(`Administrator: ${emails.admin} (TENANT_OWNER)`);
    console.log(`Residents: ${emails.resident1} → A-01-01; ${emails.resident2} → A-01-02`);
    console.log('Vacant unit: A-02-01');
    console.log(`Financial records unchanged: expenses=${result.financialCounts.expenses}, liquidations=${result.financialCounts.liquidations}, charges=${result.financialCounts.charges}, payments=${result.financialCounts.payments}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Local manual seed failed: ${message}`);
  process.exitCode = 1;
});
