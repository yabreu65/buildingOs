import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { registerFin07dMutableLiquidation } from './lib/fin07d-e2e-liquidation-registry';
import {
  assertSafeFin07dResetEnvironment,
  resetFin07dMutableState,
} from './lib/fin07d-e2e-reset';

config({ path: resolve(__dirname, '../.env') });

async function main(): Promise<void> {
  const [command, liquidationId] = process.argv.slice(2);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('FIN07D reset runner requires DATABASE_URL');
  }
  assertSafeFin07dResetEnvironment(process.env);

  if (command === 'register') {
    if (!liquidationId) {
      throw new Error('FIN07D reset runner register requires a liquidation ID');
    }
    await registerFin07dMutableLiquidation(liquidationId, databaseUrl);
    return;
  }

  if (command === 'reset') {
    const prisma = new PrismaClient();
    try {
      const context = await resetFin07dMutableState(prisma);
      process.stdout.write(JSON.stringify(context));
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  if (command === 'inspect') {
    if (!liquidationId) {
      throw new Error('FIN07D reset runner inspect requires a liquidation ID');
    }
    const prisma = new PrismaClient();
    try {
      const [offsets, chargeCount] = await Promise.all([
        prisma.liquidationIncomeOffset.findMany({
          where: { liquidationId },
          select: {
            incomeApplicationId: true,
            buildingId: true,
            originalAmountMinor: true,
            valuedAmountMinor: true,
            currencyCode: true,
            baseCurrency: true,
          },
          orderBy: { incomeApplicationId: 'asc' },
        }),
        prisma.charge.count({ where: { liquidationId } }),
      ]);
      process.stdout.write(JSON.stringify({ offsets, chargeCount }));
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  throw new Error(`Unknown FIN07D reset runner command: ${command ?? 'missing'}`);
}

void main();
