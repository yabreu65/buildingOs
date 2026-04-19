import { PrismaClient } from '@prisma/client';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

interface CliArgs {
  dryRun: boolean;
  tenantId?: string;
  buildingId?: string;
}

function addMonths(period: string, months: number): string {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(year, month - 1 + months, 1);
  const newYear = date.getFullYear();
  const newMonth = String(date.getMonth() + 1).padStart(2, '0');
  return `${newYear}-${newMonth}`;
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .option('dryRun', {
      type: 'boolean',
      default: true,
      describe: 'When true, only reports changes without writing',
    })
    .option('tenantId', {
      type: 'string',
      describe: 'Optional tenant ID to scope backfill',
    })
    .option('buildingId', {
      type: 'string',
      describe: 'Optional building ID to scope backfill',
    })
    .strict()
    .help()
    .parse();

  const args = argv as unknown as CliArgs;
  const prisma = new PrismaClient();

  try {
    console.log('=== Backfill: Expense.liquidationPeriod & Liquidation.chargePeriod ===\n');

    const expenseWhere = {
      ...(args.tenantId ? { tenantId: args.tenantId } : {}),
      ...(args.buildingId ? { buildingId: args.buildingId } : {}),
    };

    const expenses = await prisma.expense.findMany({
      where: expenseWhere,
      select: { id: true, tenantId: true, buildingId: true, period: true, liquidationPeriod: true },
      orderBy: { createdAt: 'asc' },
    });

    let expensesUpdated = 0;
    const expenseBatches: { id: string; liquidationPeriod: string }[] = [];

    for (const exp of expenses) {
      if (!exp.liquidationPeriod && exp.period) {
        expenseBatches.push({ id: exp.id, liquidationPeriod: exp.period });
      }
    }

    console.log(`- Expenses sin liquidationPeriod: ${expenseBatches.length}`);

    if (!args.dryRun && expenseBatches.length > 0) {
      for (const batch of expenseBatches) {
        await prisma.expense.update({
          where: { id: batch.id },
          data: { liquidationPeriod: batch.liquidationPeriod },
        });
        expensesUpdated++;
        if (expensesUpdated % 100 === 0) {
          console.log(`  → Actualizados ${expensesUpdated}...`);
        }
      }
    }

    console.log(`- Expenses a actualizar: ${expenseBatches.length} (dryRun: ${args.dryRun})`);

    const liquidationWhere = {
      ...(args.tenantId ? { tenantId: args.tenantId } : {}),
      ...(args.buildingId ? { buildingId: args.buildingId } : {}),
    };

    const liquidations = await prisma.liquidation.findMany({
      where: liquidationWhere,
      select: { id: true, tenantId: true, buildingId: true, period: true, chargePeriod: true },
      orderBy: { createdAt: 'asc' },
    });

    let liquidationsUpdated = 0;
    const liquidationBatches: { id: string; chargePeriod: string }[] = [];

    for (const liq of liquidations) {
      if (!liq.chargePeriod && liq.period) {
        const defaultChargePeriod = addMonths(liq.period, 1);
        liquidationBatches.push({ id: liq.id, chargePeriod: defaultChargePeriod });
      }
    }

    console.log(`- Liquidations sin chargePeriod: ${liquidationBatches.length}`);

    if (!args.dryRun && liquidationBatches.length > 0) {
      for (const batch of liquidationBatches) {
        await prisma.liquidation.update({
          where: { id: batch.id },
          data: { chargePeriod: batch.chargePeriod },
        });
        liquidationsUpdated++;
        if (liquidationsUpdated % 100 === 0) {
          console.log(`  → Actualizadas ${liquidationsUpdated}...`);
        }
      }
    }

    console.log(`- Liquidations a actualizar: ${liquidationBatches.length} (dryRun: ${args.dryRun})`);

    console.log('\n=== Resumen ===');
    console.log(`Expenses actualizados: ${args.dryRun ? expenseBatches.length : expensesUpdated}`);
    console.log(`Liquidations actualizadas: ${args.dryRun ? liquidationBatches.length : liquidationsUpdated}`);

    if (args.dryRun) {
      console.log('\n⚠️  Este fue un dry-run. Ejecutá con --dryRun false para aplicar cambios.');
    } else {
      console.log('\n✅ Backfill completado.');
    }
  } catch (error) {
    console.error('Error durante backfill:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();