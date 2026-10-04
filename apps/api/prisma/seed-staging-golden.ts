import 'dotenv/config';

import * as bcrypt from 'bcrypt';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  applyStagingGoldenSeed,
  assertConnectedStagingGoldenTarget,
  assertSafeStagingGoldenEnvironment,
  isAcceptanceHashHandoffEnabled,
  isValidAcceptanceSeedPasswordHash,
  parseAcceptanceSeedHandoff,
  selectStagingGoldenDataset,
  STAGING_GOLDEN_PASSWORD_ENV,
  StagingGoldenConnectionClient,
  StagingGoldenWriteClient,
  ConnectionIdentity,
  StagingGoldenEnvironment,
} from './lib/staging-seed/staging-golden-seed';

export function requiredPassword(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const password = environment[STAGING_GOLDEN_PASSWORD_ENV];
  if (!password || password.length < 12) {
    throw new Error(`${STAGING_GOLDEN_PASSWORD_ENV} is required and must contain at least 12 characters`);
  }
  return password;
}

export async function createAcceptanceSeedHashRecord(
  environment: StagingGoldenEnvironment,
  marker: string | undefined,
): Promise<string> {
  assertSafeStagingGoldenEnvironment(environment);
  const password = requiredPassword(environment);
  if (!marker || !/^__FINANCE_ACCEPTANCE_HASH_ONLY_[a-f0-9]{32}__$/.test(marker)) {
    throw new Error('private hash-only marker is missing or invalid');
  }
  const passwordHash = await bcrypt.hash(password, 10);
  if (!isValidAcceptanceSeedPasswordHash(passwordHash)) throw new Error('generated acceptance seed hash is invalid');
  return `${marker}:${passwordHash}`;
}

export async function verifyAcceptanceSeedPasswordHash(passwordHash: string, password: string): Promise<void> {
  if (!isValidAcceptanceSeedPasswordHash(passwordHash)) throw new Error('acceptance seed password hash is invalid');
  if (!await bcrypt.compare(password, passwordHash)) throw new Error('acceptance seed password hash does not match the QA password');
}

export async function runSeedMode(
  mode: string | undefined,
  environment: StagingGoldenEnvironment,
  writeOutput: (record: string) => void,
  runOrdinarySeed: () => Promise<void>,
): Promise<void> {
  if (mode !== 'hash-acceptance-seed-password') return runOrdinarySeed();
  const record = await createAcceptanceSeedHashRecord(environment, environment.FINANCE_ACCEPTANCE_HASH_ONLY_MARKER);
  writeOutput(`${record}\n`);
}

async function main(): Promise<void> {
  // Keep all static checks before PrismaClient construction.
  const target = assertSafeStagingGoldenEnvironment(process.env);
  const acceptanceHandoff = isAcceptanceHashHandoffEnabled(process.env);
  let passwordPreimages: readonly { readonly id: string; readonly email: string; readonly passwordHash: string }[] | undefined;
  let passwordHash: string;
  const password = requiredPassword();
  if (acceptanceHandoff) {
    let serializedHandoff = '';
    for await (const chunk of process.stdin) serializedHandoff += chunk;
    const handoff = parseAcceptanceSeedHandoff(serializedHandoff);
    await verifyAcceptanceSeedPasswordHash(handoff.seedPasswordHash, password);
    passwordPreimages = handoff.passwordHashes;
    passwordHash = handoff.seedPasswordHash;
  } else {
    passwordHash = await bcrypt.hash(password, 10);
  }
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
      passwordPreimages,
    );
    console.log('STG-DATA-01 Golden Dataset applied to verified staging database.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void runSeedMode(process.argv[2], process.env, (record) => process.stdout.write(record), main).catch((error: unknown) => {
    console.error(`STG-DATA-01 Golden Dataset failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
