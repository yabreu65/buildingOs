import 'dotenv/config';

import * as bcrypt from 'bcrypt';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  applyLocalV2Seed,
  assertSafeLocalV2SeedEnvironment,
  ConnectionIdentity,
  LOCAL_V2_PASSWORD,
  LocalV2ConnectionClient,
  LocalV2WriteClient,
} from './lib/local-seed/local-v2-seed';

async function main(): Promise<void> {
  // This guard must stay before PrismaClient construction.
  const target = assertSafeLocalV2SeedEnvironment(process.env);
  const passwordHash = await bcrypt.hash(LOCAL_V2_PASSWORD, 10);
  const prisma = new PrismaClient();

  const connection: LocalV2ConnectionClient = {
    async readConnectionIdentity(): Promise<ConnectionIdentity> {
      const rows = await prisma.$queryRaw<ConnectionIdentity[]>(Prisma.sql`
        SELECT
          current_database() AS "database",
          inet_server_addr()::text AS "address"
      `);
      const identity = rows[0];
      if (!identity) {
        throw new Error('LOCAL V2 seed could not read the PostgreSQL connection identity');
      }
      return identity;
    },
  };

  try {
    // The generated Prisma delegates use model-specific argument types, while the seed
    // port intentionally uses one structural delegate contract for isolated tests.
    // Keep this unknown-only adapter boundary here so the real PrismaClient invocation
    // remains unchanged without weakening either side with `any`.
    await applyLocalV2Seed(
      prisma as unknown as LocalV2WriteClient,
      connection,
      target,
      {
        passwordHash,
        matches: (plainText, hash) => bcrypt.compare(plainText, hash),
      },
    );
    console.log(`LOCAL V2 seed applied to ${target.database} on ${target.host}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LOCAL V2 seed failed: ${message}`);
  process.exitCode = 1;
});
