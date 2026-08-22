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

  if (command === 'inspect-history') {
    if (!liquidationId) {
      throw new Error('FIN07D reset runner inspect-history requires a liquidation ID');
    }
    const prisma = new PrismaClient();
    try {
      const liquidation = await prisma.liquidation.findUnique({
        where: { id: liquidationId },
        select: {
          id: true,
          tenantId: true,
          buildingId: true,
          period: true,
          status: true,
          valuationMode: true,
          baseCurrency: true,
          totalAmountMinor: true,
          totalsByCurrency: true,
          expenseSnapshot: true,
          publicationSnapshot: true,
          grossExpenseAmountMinor: true,
          adjustmentAmountMinor: true,
          preIncomeAmountMinor: true,
          incomeOffsetAmountMinor: true,
          netDistributableAmountMinor: true,
          incomeOffsetSnapshot: true,
          incomeOffsetsByCurrency: true,
        },
      });
      if (!liquidation) {
        throw new Error(`FIN07D historical liquidation is missing: ${liquidationId}`);
      }
      const [charges, offsetCount] = await Promise.all([
        prisma.charge.findMany({
          where: { liquidationId },
          select: {
            id: true,
            tenantId: true,
            buildingId: true,
            unitId: true,
            period: true,
            amount: true,
            currency: true,
            dueDate: true,
            status: true,
            concept: true,
            liquidationId: true,
          },
          orderBy: { unitId: 'asc' },
        }),
        prisma.liquidationIncomeOffset.count({ where: { liquidationId } }),
      ]);
      process.stdout.write(JSON.stringify({ liquidation, charges, offsetCount }));
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  if (command === 'inspect-legacy') {
    if (!liquidationId) {
      throw new Error('FIN07D reset runner inspect-legacy requires an income ID');
    }
    const prisma = new PrismaClient();
    try {
      const income = await prisma.income.findUnique({
        where: { id: liquidationId },
        select: { id: true, tenantId: true, buildingId: true, period: true },
      });
      if (!income) {
        throw new Error(`FIN07D legacy income is missing: ${liquidationId}`);
      }
      const applications = await prisma.incomeApplication.findMany({
        where: { tenantId: income.tenantId, incomeId: income.id },
        select: {
          id: true,
          destinationType: true,
          fundId: true,
          amountMinor: true,
          currencyCode: true,
          policyVersionId: true,
          legacyDestination: true,
        },
        orderBy: { id: 'asc' },
      });
      const applicationIds = applications.map((application) => application.id);
      const [fundTransactions, conflictingLiquidations] = await Promise.all([
        applicationIds.length === 0
          ? []
          : prisma.fundTransaction.findMany({
              where: { tenantId: income.tenantId, incomeApplicationId: { in: applicationIds } },
              select: {
                id: true,
                fundId: true,
                direction: true,
                amountMinor: true,
                currencyCode: true,
                occurredAt: true,
                description: true,
                incomeApplicationId: true,
              },
              orderBy: { id: 'asc' },
            }),
        income.buildingId
          ? prisma.liquidation.findMany({
              where: {
                tenantId: income.tenantId,
                buildingId: income.buildingId,
                period: income.period,
                status: { in: ['DRAFT', 'REVIEWED', 'PUBLISHED'] },
              },
              select: {
                id: true,
                status: true,
                totalAmountMinor: true,
                publicationSnapshot: true,
              },
              orderBy: { id: 'asc' },
            })
          : [],
      ]);
      const conflictingIds = conflictingLiquidations.map((liquidation) => liquidation.id);
      const conflictCharges = conflictingIds.length === 0
        ? []
        : await prisma.charge.findMany({
            where: { liquidationId: { in: conflictingIds } },
            select: {
              id: true,
              liquidationId: true,
              unitId: true,
              amount: true,
              currency: true,
              status: true,
            },
            orderBy: { id: 'asc' },
          });
      process.stdout.write(JSON.stringify({
        income,
        applications,
        fundTransactions,
        conflictingLiquidations,
        conflictCharges,
      }));
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  throw new Error(`Unknown FIN07D reset runner command: ${command ?? 'missing'}`);
}

void main();
