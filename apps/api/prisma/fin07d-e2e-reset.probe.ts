import 'dotenv/config';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { LiquidationStatus, PrismaClient } from '@prisma/client';
import {
  FIN07D_MUTABLE_MARKER,
  assertSafeFin07dResetEnvironment,
  createFin07dDisposableMarker,
  resetFin07dMutableState,
  resolveFin07dFixtureContext,
} from './lib/fin07d-e2e-reset';
import {
  clearFin07dMutableLiquidations,
  readFin07dMutableLiquidations,
  registerFin07dMutableLiquidation,
  unregisterFin07dMutableLiquidations,
} from './lib/fin07d-e2e-liquidation-registry';

const prisma = new PrismaClient();
const execFileAsync = promisify(execFile);
const CONCURRENT_REGISTRY_COUNT = 16;

function expectGuardRejection(
  environment: Parameters<typeof assertSafeFin07dResetEnvironment>[0],
  expectedMessage: RegExp,
): void {
  try {
    assertSafeFin07dResetEnvironment(environment);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (expectedMessage.test(message)) {
      return;
    }
    throw error;
  }
  throw new Error(`FIN07D reset guard did not reject ${expectedMessage}`);
}

async function expectAsyncRejection(
  action: () => Promise<unknown>,
  expectedMessage: RegExp,
): Promise<void> {
  try {
    await action();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (expectedMessage.test(message)) {
      return;
    }
    throw error;
  }
  throw new Error(`FIN07D async guard did not reject ${expectedMessage}`);
}

async function proveConcurrentRegistry(databaseUrl: string): Promise<void> {
  const initialIds = await readFin07dMutableLiquidations(databaseUrl);
  const generatedIds = Array.from(
    { length: CONCURRENT_REGISTRY_COUNT },
    () => `c${randomBytes(16).toString('hex')}`,
  );

  await expectAsyncRejection(
    () => registerFin07dMutableLiquidation('../invalid', databaseUrl),
    /invalid liquidation ID/,
  );

  try {
    await Promise.all(generatedIds.map((id) => registerFin07dMutableLiquidation(id, databaseUrl)));
    const registeredIds = await readFin07dMutableLiquidations(databaseUrl);
    const lostIds = generatedIds.filter((id) => !registeredIds.includes(id));
    if (lostIds.length !== 0 || new Set(registeredIds).size !== registeredIds.length) {
      throw new Error(`FIN07D registry concurrent registration lost ${lostIds.length} IDs`);
    }

    const alternateTarget = new URL(databaseUrl);
    alternateTarget.pathname = '/buildingos_registry_isolation_probe';
    try {
      await registerFin07dMutableLiquidation(generatedIds[0]!, alternateTarget.toString());
      const [alternateIds, currentIds] = await Promise.all([
        readFin07dMutableLiquidations(alternateTarget.toString()),
        readFin07dMutableLiquidations(databaseUrl),
      ]);
      if (
        alternateIds.length !== 1 ||
        alternateIds[0] !== generatedIds[0] ||
        generatedIds.some((id) => !currentIds.includes(id))
      ) {
        throw new Error('FIN07D registry reused a directory across database targets');
      }
    } finally {
      await clearFin07dMutableLiquidations(alternateTarget.toString());
    }

    const childScript = [
      "const { readFin07dMutableLiquidations } = require('./prisma/lib/fin07d-e2e-liquidation-registry');",
      'readFin07dMutableLiquidations(process.env.DATABASE_URL)',
      '  .then((ids) => process.stdout.write(JSON.stringify(ids)))',
      '  .catch((error) => { process.stderr.write(String(error)); process.exit(1); });',
    ].join('\n');
    const childResult = await execFileAsync(
      process.execPath,
      ['-r', 'ts-node/register', '-e', childScript],
      { cwd: process.cwd(), env: process.env },
    );
    const childIds = JSON.parse(childResult.stdout) as unknown;
    if (
      !Array.isArray(childIds) ||
      generatedIds.some((id) => !childIds.includes(id))
    ) {
      throw new Error('FIN07D registry was not readable from a separate Node process');
    }

    const removedIds = generatedIds.slice(0, CONCURRENT_REGISTRY_COUNT / 2);
    const retainedIds = generatedIds.slice(CONCURRENT_REGISTRY_COUNT / 2);
    await Promise.all(removedIds.map((id) => unregisterFin07dMutableLiquidations([id], databaseUrl)));
    const afterUnregister = await readFin07dMutableLiquidations(databaseUrl);
    if (
      removedIds.some((id) => afterUnregister.includes(id)) ||
      retainedIds.some((id) => !afterUnregister.includes(id)) ||
      initialIds.some((id) => !afterUnregister.includes(id))
    ) {
      throw new Error('FIN07D registry concurrent unregister changed unrelated ownership entries');
    }
  } finally {
    await unregisterFin07dMutableLiquidations(generatedIds, databaseUrl);
  }
}

interface DraftInput {
  readonly label: string;
  readonly tenantId: string;
  readonly buildingId: string;
  readonly membershipId: string;
  readonly period: string;
  readonly status: LiquidationStatus;
}

async function createProbeLiquidation(input: DraftInput): Promise<string> {
  const liquidation = await prisma.liquidation.create({
    data: {
      tenantId: input.tenantId,
      buildingId: input.buildingId,
      period: input.period,
      status: LiquidationStatus.DRAFT,
      baseCurrency: 'ARS',
      totalAmountMinor: 1,
      totalsByCurrency: { ARS: 1 },
      expenseSnapshot: [],
      unitCount: 1,
      generatedByMembershipId: input.membershipId,
    },
    select: { id: true },
  }).catch((error: unknown) => {
    throw new Error(`FIN07D reset probe could not create ${input.label}: ${error instanceof Error ? error.message : String(error)}`);
  });

  if (input.status === LiquidationStatus.REVIEWED || input.status === LiquidationStatus.PUBLISHED) {
    await prisma.liquidation.update({
      where: { id: liquidation.id },
      data: {
        status: LiquidationStatus.REVIEWED,
        reviewedByMembershipId: input.membershipId,
        reviewedAt: new Date('2026-06-30T01:00:00.000Z'),
      },
    });
  }
  if (input.status === LiquidationStatus.PUBLISHED) {
    await prisma.liquidation.update({
      where: { id: liquidation.id },
      data: {
        status: LiquidationStatus.PUBLISHED,
        publishedByMembershipId: input.membershipId,
        publishedAt: new Date('2026-06-30T02:00:00.000Z'),
        publicationSnapshot: {
          version: 1,
          baseCurrency: 'ARS',
          totalAmountMinor: 1,
          unitCount: 1,
          items: [],
        },
      },
    });
  }
  return liquidation.id;
}

async function expectRegisteredLiquidationRefusal(
  databaseUrl: string,
  liquidationId: string,
  expectedMessage: RegExp,
): Promise<void> {
  await registerFin07dMutableLiquidation(liquidationId, databaseUrl);
  try {
    await resetFin07dMutableState(prisma);
    throw new Error(`FIN07D reset unexpectedly accepted ${expectedMessage}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!expectedMessage.test(message)) {
      throw error;
    }
  }

  const retainedCount = await prisma.liquidation.count({ where: { id: liquidationId } });
  if (retainedCount !== 1) {
    throw new Error('FIN07D reset deleted a registered liquidation that failed ownership validation');
  }
  await unregisterFin07dMutableLiquidations([liquidationId], databaseUrl);
}

async function main(): Promise<void> {
  expectGuardRejection({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://localhost:5434/buildingos',
    FIN07D_E2E_RESET: '1',
  }, /NODE_ENV=production/);
  expectGuardRejection({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://database.example.com:5434/buildingos',
    FIN07D_E2E_RESET: '1',
  }, /non-local database host/);
  expectGuardRejection({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost:5434/unknown',
    FIN07D_E2E_RESET: '1',
  }, /unknown database target/);

  const databaseUrl = assertSafeFin07dResetEnvironment(process.env).toString();
  await proveConcurrentRegistry(databaseUrl);

  const before = await resolveFin07dFixtureContext(prisma);
  const tenantBBuilding = await prisma.building.findUnique({
    where: { tenantId_name: { tenantId: before.tenantBId, name: 'Edificio Test B' } },
    select: { id: true },
  });
  if (!tenantBBuilding) {
    throw new Error('FIN07D reset probe requires the deterministic Tenant B building');
  }
  const tenantBAdmin = await prisma.user.findUnique({
    where: { email: 'test-tenant-admin-b@buildingos.local' },
    select: { id: true },
  });
  if (!tenantBAdmin) {
    throw new Error('FIN07D reset probe requires the deterministic Tenant B admin');
  }
  const tenantBMembership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: tenantBAdmin.id, tenantId: before.tenantBId } },
    select: { id: true },
  });
  if (!tenantBMembership) {
    throw new Error('FIN07D reset probe requires the deterministic Tenant B membership');
  }

  const createdLiquidationIds: string[] = [];
  try {
    const wrongTenantId = await createProbeLiquidation({
      label: 'wrong-tenant liquidation',
      tenantId: before.tenantBId,
      buildingId: tenantBBuilding.id,
      membershipId: tenantBMembership.id,
      period: '2026-06',
      status: LiquidationStatus.DRAFT,
    });
    createdLiquidationIds.push(wrongTenantId);
    await expectRegisteredLiquidationRefusal(databaseUrl, wrongTenantId, /another tenant/);
    await prisma.liquidation.delete({ where: { id: wrongTenantId } });

    const wrongBuildingId = await createProbeLiquidation({
      label: 'wrong-building liquidation',
      tenantId: before.tenantAId,
      buildingId: before.buildingA2Id,
      membershipId: before.adminMembershipId,
      period: '2026-06',
      status: LiquidationStatus.DRAFT,
    });
    createdLiquidationIds.push(wrongBuildingId);
    await expectRegisteredLiquidationRefusal(databaseUrl, wrongBuildingId, /another building/);
    await prisma.liquidation.delete({ where: { id: wrongBuildingId } });

    const wrongPeriodId = await createProbeLiquidation({
      label: 'wrong-period liquidation',
      tenantId: before.tenantAId,
      buildingId: before.buildingA1Id,
      membershipId: before.adminMembershipId,
      period: '2026-08',
      status: LiquidationStatus.DRAFT,
    });
    createdLiquidationIds.push(wrongPeriodId);
    await expectRegisteredLiquidationRefusal(databaseUrl, wrongPeriodId, /period 2026-08/);
    await prisma.liquidation.delete({ where: { id: wrongPeriodId } });

    const publishedId = await createProbeLiquidation({
      label: 'published liquidation',
      tenantId: before.tenantAId,
      buildingId: before.buildingA1Id,
      membershipId: before.adminMembershipId,
      period: '2026-06',
      status: LiquidationStatus.PUBLISHED,
    });
    createdLiquidationIds.push(publishedId);
    await expectRegisteredLiquidationRefusal(databaseUrl, publishedId, /status PUBLISHED/);
    await prisma.liquidation.delete({ where: { id: publishedId } });

    const registeredId = await createProbeLiquidation({
      label: 'registered liquidation',
      tenantId: before.tenantAId,
      buildingId: before.buildingA1Id,
      membershipId: before.adminMembershipId,
      period: '2026-06',
      status: LiquidationStatus.DRAFT,
    });
    const unregisteredId = await createProbeLiquidation({
      label: 'unregistered liquidation',
      tenantId: before.tenantAId,
      buildingId: before.buildingA1Id,
      membershipId: before.adminMembershipId,
      period: '2026-07',
      status: LiquidationStatus.DRAFT,
    });
    createdLiquidationIds.push(registeredId, unregisteredId);
    await registerFin07dMutableLiquidation(registeredId, databaseUrl);

    const persistedRegistry = await readFin07dMutableLiquidations(databaseUrl);
    if (!persistedRegistry.includes(registeredId) || persistedRegistry.includes(unregisteredId)) {
      throw new Error('FIN07D liquidation registry did not persist exact ownership');
    }

    const markerId = await createFin07dDisposableMarker(prisma);
    const markerCount = await prisma.income.count({ where: { id: markerId } });
    if (markerCount !== 1) {
      throw new Error('FIN07D reset probe could not create its disposable marker');
    }

    const afterFirstReset = await resetFin07dMutableState(prisma);
    const [registeredCount, unregisteredCount, remainingMarkerCount] = await Promise.all([
      prisma.liquidation.count({ where: { id: registeredId } }),
      prisma.liquidation.count({ where: { id: unregisteredId } }),
      prisma.income.count({
        where: {
          tenantId: before.tenantAId,
          description: { startsWith: FIN07D_MUTABLE_MARKER },
        },
      }),
    ]);
    if (registeredCount !== 0) {
      throw new Error('FIN07D reset probe retained the registered liquidation');
    }
    if (unregisteredCount !== 1) {
      throw new Error('FIN07D reset probe deleted the unregistered liquidation');
    }
    if (remainingMarkerCount !== 0) {
      throw new Error('FIN07D reset probe left disposable mutable state behind');
    }
    if (
      afterFirstReset.historicalV1LiquidationId !== before.historicalV1LiquidationId ||
      afterFirstReset.historicalV2LiquidationId !== before.historicalV2LiquidationId
    ) {
      throw new Error('FIN07D reset probe changed immutable historical liquidations');
    }
    if ((await readFin07dMutableLiquidations(databaseUrl)).includes(registeredId)) {
      throw new Error('FIN07D reset probe left a stale registered liquidation ID');
    }

    const afterSecondReset = await resetFin07dMutableState(prisma);
    if (JSON.stringify(afterSecondReset) !== JSON.stringify(afterFirstReset)) {
      throw new Error('FIN07D reset probe produced a non-idempotent fixture context');
    }
  } finally {
    await unregisterFin07dMutableLiquidations(createdLiquidationIds, databaseUrl);
    await prisma.liquidation.deleteMany({ where: { id: { in: createdLiquidationIds } } });
  }

  process.stdout.write(
    `FIN07D reset probe passed: concurrent register count=${CONCURRENT_REGISTRY_COUNT}, lost=0, concurrent unregister correct, restart persistence proven, ownership refusals enforced, baseline intact, reset idempotent x2\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
