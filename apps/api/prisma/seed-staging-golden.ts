import 'dotenv/config';

import * as bcrypt from 'bcrypt';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  applyStagingGoldenSeed,
  assertConnectedStagingGoldenTarget,
  assertSafeStagingGoldenEnvironment,
  selectStagingGoldenDataset,
  STAGING_GOLDEN_PASSWORD_ENV,
  StagingGoldenConnectionClient,
  StagingGoldenWriteClient,
  ConnectionIdentity,
} from './lib/staging-seed/staging-golden-seed';

export function requiredPassword(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const password = environment[STAGING_GOLDEN_PASSWORD_ENV];
  if (!password || password.length < 12) {
    throw new Error(`${STAGING_GOLDEN_PASSWORD_ENV} is required and must contain at least 12 characters`);
  }
  return password;
}

async function main(): Promise<void> {
  // Keep all static checks before PrismaClient construction.
  const target = assertSafeStagingGoldenEnvironment(process.env);
  const passwordHash = await bcrypt.hash(requiredPassword(), 10);
  const prisma = new PrismaClient();
  const connection: StagingGoldenConnectionClient = {
    async readConnectionIdentity(): Promise<ConnectionIdentity> {
      const rows = await prisma.$queryRaw<ConnectionIdentity[]>(Prisma.sql`
        SELECT current_database() AS "database", inet_server_addr()::text AS "address"
      `);
      const identity = rows[0];
      if (!identity) throw new Error('STAGING GOLDEN seed could not read PostgreSQL connection identity');
      return identity;
    },
  };

  try {
    await assertConnectedStagingGoldenTarget(connection, target);
    // The adapter boundary is intentionally unknown-only; the seed itself exposes no
    // generic SQL or destructive delegate and remains tenant/ID scoped.
    await applyStagingGoldenSeed(
      prisma as unknown as StagingGoldenWriteClient,
      passwordHash,
      selectStagingGoldenDataset(process.env),
    );
    console.log('STG-DATA-01 Golden Dataset applied to verified staging database.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(`STG-DATA-01 Golden Dataset failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
