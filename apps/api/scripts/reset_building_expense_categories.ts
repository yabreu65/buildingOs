import { PrismaClient, Expense, MovementType, ExpenseLedgerCategory } from '@prisma/client';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

interface BuildingExpenseCategory {
  code: string;
  name: string;
  tooltip: string;
  isActive: boolean;
  sortOrder: number;
}

const BUILDING_EXPENSE_CATEGORIES: BuildingExpenseCategory[] = [
  {
    code: 'EXP_ELEC_BUILDING_INTERNAL',
    name: 'Electricidad del edificio (áreas comunes internas)',
    tooltip: 'Pasillos, escaleras, bombas, ascensor (si aplica), portón del edificio.',
    isActive: true,
    sortOrder: 10,
  },
  {
    code: 'EXP_WATER_BUILDING_INTERNAL',
    name: 'Agua del edificio (áreas comunes internas)',
    tooltip: 'Servicios internos del edificio.',
    isActive: true,
    sortOrder: 20,
  },
  {
    code: 'EXP_CLEANING_BUILDING',
    name: 'Limpieza del edificio (personal e insumos)',
    tooltip: 'Limpieza de áreas internas del edificio.',
    isActive: true,
    sortOrder: 30,
  },
  {
    code: 'EXP_MAINT_BUILDING_GENERAL',
    name: 'Mantenimiento general del edificio',
    tooltip: 'Preventivo/correctivo general.',
    isActive: true,
    sortOrder: 40,
  },
  {
    code: 'EXP_REPAIRS_BUILDING',
    name: 'Reparaciones y arreglos del edificio',
    tooltip: 'Reparaciones puntuales internas.',
    isActive: true,
    sortOrder: 50,
  },
  {
    code: 'EXP_PAINTING_BUILDING',
    name: 'Pintura y acabados del edificio',
    tooltip: 'Pintura de pasillos, áreas internas.',
    isActive: true,
    sortOrder: 60,
  },
  {
    code: 'EXP_CONCIERGE_BUILDING',
    name: 'Portería / Conserjería del edificio',
    tooltip: 'Personal asignado al edificio (si aplica por torre).',
    isActive: true,
    sortOrder: 70,
  },
  {
    code: 'EXP_WATER_SYSTEM_BUILDING',
    name: 'Sistema de agua del edificio (bombas / hidroneumático)',
    tooltip: 'Mantenimiento de bombas/tanques del edificio.',
    isActive: true,
    sortOrder: 80,
  },
  {
    code: 'EXP_ACCESS_BUILDING',
    name: 'Accesos del edificio (portón/cerraduras/cerrajería)',
    tooltip: 'Accesos del edificio si están separados por torre.',
    isActive: true,
    sortOrder: 90,
  },
  {
    code: 'EXP_ELEVATORS_BUILDING',
    name: 'Ascensores del edificio (mantenimiento y revisión)',
    tooltip: 'Solo si el edificio tiene ascensor.',
    isActive: false,
    sortOrder: 100,
  },
  {
    code: 'EXP_SECURITY_BUILDING',
    name: 'Seguridad del edificio (vigilancia)',
    tooltip: 'Si hay vigilancia asignada a ese edificio.',
    isActive: false,
    sortOrder: 110,
  },
  {
    code: 'EXP_INSURANCE_BUILDING',
    name: 'Seguro del edificio',
    tooltip: 'Póliza específica del edificio (si está separada).',
    isActive: true,
    sortOrder: 120,
  },
  {
    code: 'EXP_LIABILITY_BUILDING',
    name: 'Responsabilidad civil del edificio',
    tooltip: 'Si la RC se maneja por edificio.',
    isActive: false,
    sortOrder: 130,
  },
  {
    code: 'EXP_TAXES_BUILDING',
    name: 'Impuestos y contribuciones del edificio',
    tooltip: 'Tributos asociados a esa torre/edificio.',
    isActive: true,
    sortOrder: 140,
  },
  {
    code: 'EXP_BANK_FEES_BUILDING',
    name: 'Comisiones bancarias del edificio',
    tooltip: 'Costos bancarios si cada torre recauda en cuenta distinta.',
    isActive: false,
    sortOrder: 150,
  },
  {
    code: 'EXP_LEGAL_ACCOUNTING_BUILDING',
    name: 'Legales y contabilidad del edificio',
    tooltip: 'Honorarios importados por torre.',
    isActive: false,
    sortOrder: 160,
  },
  {
    code: 'EXP_RESERVE_FUND_BUILDING',
    name: 'Fondo de reserva del edificio',
    tooltip: 'Aporte a reserva por torre.',
    isActive: true,
    sortOrder: 170,
  },
];

const MANAGED_BUILDING_CODES = BUILDING_EXPENSE_CATEGORIES.map((c) => c.code);

interface DryRunReport {
  tenantId: string;
  tenantName: string | null;
  existingBuildingExpenseCategoriesCount: number;
  referencedByExpensesCount: number;
  referencedByIncomesCount: number;
  recommendedMode: 'safe' | 'wipe';
  reason: string;
}

interface ApplyResult {
  tenantId: string;
  deletedExpenses: number;
  deletedCategories: number;
  insertedCategories: number;
  categories: Array<{ code: string; name: string; isActive: boolean; sortOrder: number }>;
}

function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

async function getManagedBuildingCategoriesForTenant(
  prisma: PrismaClient,
  tenantId: string
): Promise<ExpenseLedgerCategory[]> {
  return prisma.expenseLedgerCategory.findMany({
    where: {
      tenantId,
      movementType: 'EXPENSE',
      code: { in: MANAGED_BUILDING_CODES },
    },
  });
}

async function getReferencedExpensesForCategories(
  prisma: PrismaClient,
  categoryIds: string[]
): Promise<number> {
  if (categoryIds.length === 0) return 0;
  const result = await prisma.expense.count({
    where: { categoryId: { in: categoryIds } },
  });
  return result;
}

async function getAllExpenseCategoriesForTenant(
  prisma: PrismaClient,
  tenantId: string
): Promise<ExpenseLedgerCategory[]> {
  return prisma.expenseLedgerCategory.findMany({
    where: {
      tenantId,
      movementType: 'EXPENSE',
    },
  });
}

async function dryRunAllTenants(prisma: PrismaClient): Promise<DryRunReport[]> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  const reports: DryRunReport[] = [];

  for (const tenant of tenants) {
    const categories = await getAllExpenseCategoriesForTenant(prisma, tenant.id);
    const categoryIds = categories.map((c) => c.id);

    const referencedByExpensesCount = await getReferencedExpensesForCategories(
      prisma,
      categoryIds
    );

    const referencedByIncomesCount = categoryIds.length
      ? await prisma.income.count({
          where: { tenantId: tenant.id, categoryId: { in: categoryIds } },
        })
      : 0;

    const recommendedMode: 'safe' | 'wipe' = referencedByExpensesCount > 0 ? 'safe' : 'wipe';

    reports.push({
      tenantId: tenant.id,
      tenantName: tenant.name,
      existingBuildingExpenseCategoriesCount: categories.length,
      referencedByExpensesCount,
      referencedByIncomesCount,
      recommendedMode,
      reason:
        recommendedMode === 'wipe'
          ? 'referencedByExpensesCount=0 => wipe permitido en DEV'
          : `referencedByExpensesCount=${referencedByExpensesCount} => usar safe (no wipe)`,
    });
  }

  return reports;
}

async function dryRunTenant(
  prisma: PrismaClient,
  tenantId: string,
  mode: 'auto' | 'safe' | 'wipe'
): Promise<{
  tenantId: string;
  mode: 'safe' | 'wipe';
  reason: string;
  managedCategories: Array<{ code: string; name: string; id: string }>;
  referencedExpenses: number;
}> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  });

  if (!tenant) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

  const categories = await getManagedBuildingCategoriesForTenant(prisma, tenantId);
  const referencedCount = await getReferencedExpensesForCategories(
    prisma,
    categories.map((c) => c.id)
  );

  let finalMode: 'safe' | 'wipe';
  if (mode === 'auto') {
    finalMode = referencedCount > 0 ? 'safe' : 'wipe';
  } else {
    finalMode = mode;
  }

  return {
    tenantId,
    mode: finalMode,
    reason:
      finalMode === 'wipe'
        ? 'No hay gastos referenciando rubros BUILDING. Modo wipe ejecutado.'
        : `Hay ${referencedCount} gastos referenciando rubros BUILDING. Modo safe ejecutado.`,
    managedCategories: categories.map((c) => ({
      code: c.code || '',
      name: c.name,
      id: c.id,
    })),
    referencedExpenses: referencedCount,
  };
}

async function applyWipe(
  prisma: PrismaClient,
  tenantId: string
): Promise<ApplyResult> {
  const categories = await getManagedBuildingCategoriesForTenant(prisma, tenantId);
  const categoryIds = categories.map((c) => c.id);

  let deletedExpenses = 0;
  if (categoryIds.length > 0) {
    const deleteResult = await prisma.expense.deleteMany({
      where: { tenantId, categoryId: { in: categoryIds } },
    });
    deletedExpenses = deleteResult.count;
  }

  const deleteCatResult = await prisma.expenseLedgerCategory.deleteMany({
    where: {
      tenantId,
      movementType: 'EXPENSE',
      code: { in: MANAGED_BUILDING_CODES },
    },
  });
  const deletedCategories = deleteCatResult.count;

  const insertedCategories: Array<{
    code: string;
    name: string;
    isActive: boolean;
    sortOrder: number;
  }> = [];

  for (const cat of BUILDING_EXPENSE_CATEGORIES) {
    const existing = await prisma.expenseLedgerCategory.findFirst({
      where: { tenantId, code: cat.code },
    });

    if (existing) {
      await prisma.expenseLedgerCategory.update({
        where: { id: existing.id },
        data: {
          name: cat.name,
          description: cat.tooltip,
          movementType: 'EXPENSE' as MovementType,
          sortOrder: cat.sortOrder,
          isActive: cat.isActive,
        },
      });
    } else {
      await prisma.expenseLedgerCategory.create({
        data: {
          tenantId,
          code: cat.code,
          name: cat.name,
          description: cat.tooltip,
          movementType: 'EXPENSE' as MovementType,
          sortOrder: cat.sortOrder,
          isActive: cat.isActive,
        },
      });
    }

    insertedCategories.push({
      code: cat.code,
      name: cat.name,
      isActive: cat.isActive,
      sortOrder: cat.sortOrder,
    });
  }

  return {
    tenantId,
    deletedExpenses,
    deletedCategories,
    insertedCategories: insertedCategories.length,
    categories: insertedCategories,
  };
}

async function applySafe(
  prisma: PrismaClient,
  tenantId: string
): Promise<ApplyResult> {
  const allCategories = await getAllExpenseCategoriesForTenant(prisma, tenantId);
  const existingByCode = new Map(allCategories.map((c) => [c.code, c]));

  let createdCount = 0;
  let updatedCount = 0;

  for (const cat of BUILDING_EXPENSE_CATEGORIES) {
    const existing = existingByCode.get(cat.code);

    if (!existing) {
      await prisma.expenseLedgerCategory.create({
        data: {
          tenantId,
          code: cat.code,
          name: cat.name,
          description: cat.tooltip,
          movementType: 'EXPENSE' as MovementType,
          sortOrder: cat.sortOrder,
          isActive: cat.isActive,
        },
      });
      createdCount++;
    } else {
      await prisma.expenseLedgerCategory.update({
        where: { id: existing.id },
        data: {
          name: cat.name,
          description: cat.tooltip,
          sortOrder: cat.sortOrder,
          isActive: cat.isActive,
        },
      });
      updatedCount++;
    }
  }

  const finalCategories = await getManagedBuildingCategoriesForTenant(prisma, tenantId);

  return {
    tenantId,
    deletedExpenses: 0,
    deletedCategories: 0,
    insertedCategories: finalCategories.length,
    categories: finalCategories.map((c) => ({
      code: c.code || '',
      name: c.name,
      isActive: c.isActive,
      sortOrder: c.sortOrder,
    })),
  };
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const isAllTenants = rawArgs.includes('--all-tenants');

  const argv = await yargs(hideBin(process.argv))
    .option('tenantId', {
      type: 'string',
      description: 'Tenant ID to operate on',
    })
    .option('all-tenants', {
      type: 'boolean',
      description: 'Run on all tenants (dry-run or apply)',
      default: false,
    })
    .option('dry-run', {
      type: 'boolean',
      description: 'Dry-run mode (read-only)',
      default: false,
    })
    .option('mode', {
      type: 'string',
      description: 'Mode: auto, safe, or wipe',
      choices: ['auto', 'safe', 'wipe'],
      default: 'auto',
    })
    .option('apply', {
      type: 'boolean',
      description: 'Apply changes (requires --confirm)',
      default: false,
    })
    .option('confirm', {
      type: 'string',
      description: 'Confirmation string required for apply',
    })
    .option('confirmTenantId', {
      type: 'string',
      description: 'Tenant ID for confirmation (must match --tenantId)',
    })
    .conflicts('tenantId', 'all-tenants')
    .argv;

  if (!isAllTenants && !argv.tenantId) {
    console.error('Either --tenantId or --all-tenants is required');
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    // === ALL TENANTS DRY-RUN ===
    if (isAllTenants && !argv.apply) {
      console.log('Running --all-tenants --dry-run --mode=auto');
      const reports = await dryRunAllTenants(prisma);
      console.log(JSON.stringify(reports, null, 2));
      return;
    }

    // === ALL TENANTS APPLY ===
    if (isAllTenants && argv.apply) {
      if (!argv.confirm) {
        throw new Error('--apply requires --confirm=RESET_BUILDING_CATEGORIES_ALL_DEV');
      }
      if (argv.confirm !== 'RESET_BUILDING_CATEGORIES_ALL_DEV') {
        throw new Error('--confirm must be RESET_BUILDING_CATEGORIES_ALL_DEV for --all-tenants apply');
      }

      console.log('Running --all-tenants --apply --mode=auto');

      const tenants = await prisma.tenant.findMany({
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
      });

      const results: Array<{
        tenantId: string;
        tenantName: string | null;
        actionTaken: 'wipe' | 'safe' | 'skipped';
        counts: { deletedExpenses: number; deletedCategories: number; created: number; updated: number; deactivated: number };
        errors: string[];
      }> = [];

      let wipeCount = 0;
      let safeCount = 0;
      let failedCount = 0;

      for (const tenant of tenants) {
        const tenantResult: {
          tenantId: string;
          tenantName: string | null;
          actionTaken: 'wipe' | 'safe' | 'skipped';
          counts: { deletedExpenses: number; deletedCategories: number; created: number; updated: number; deactivated: number };
          errors: string[];
        } = {
          tenantId: tenant.id,
          tenantName: tenant.name,
          actionTaken: 'skipped',
          counts: { deletedExpenses: 0, deletedCategories: 0, created: 0, updated: 0, deactivated: 0 },
          errors: [],
        };

        try {
          const allCategories = await getAllExpenseCategoriesForTenant(prisma, tenant.id);
          const categoryIds = allCategories.map((c) => c.id);
          const referencedCount = await getReferencedExpensesForCategories(prisma, categoryIds);

          let action: 'wipe' | 'safe';
          if (argv.mode === 'auto') {
            action = referencedCount > 0 ? 'safe' : 'wipe';
          } else {
            action = argv.mode as 'wipe' | 'safe';
          }

          let applyResult: ApplyResult;

          if (action === 'wipe') {
            console.log(`[${tenant.name}] Executing WIPE...`);
            applyResult = await applyWipe(prisma, tenant.id);
            wipeCount++;
          } else {
            console.log(`[${tenant.name}] Executing SAFE...`);
            applyResult = await applySafe(prisma, tenant.id);
            safeCount++;
          }

          tenantResult.actionTaken = action;
          tenantResult.counts = {
            deletedExpenses: applyResult.deletedExpenses,
            deletedCategories: applyResult.deletedCategories,
            created: applyResult.insertedCategories,
            updated: applyResult.insertedCategories - applyResult.deletedCategories,
            deactivated: 0,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          tenantResult.errors.push(errMsg);
          failedCount++;
          console.error(`[${tenant.name}] ERROR: ${errMsg}`);
        }

        results.push(tenantResult);
      }

      console.log('\n=== FINAL REPORT ===');
      console.log(JSON.stringify({
        summary: { total: tenants.length, wipe: wipeCount, safe: safeCount, failed: failedCount },
        results,
      }, null, 2));
      return;
    }

    // === SINGLE TENANT OPERATIONS ===
    if (!argv.tenantId) {
      throw new Error('--tenantId is required for single tenant operations');
    }

    if (argv.apply) {
      if (!argv.confirm) {
        throw new Error('--apply requires --confirm=RESET_BUILDING_CATEGORIES');
      }
      if (argv.confirm !== 'RESET_BUILDING_CATEGORIES') {
        throw new Error('--confirm must be RESET_BUILDING_CATEGORIES');
      }
      if (!argv.confirmTenantId) {
        throw new Error('--apply requires --confirmTenantId');
      }
      if (argv.confirmTenantId !== argv.tenantId) {
        throw new Error('--confirmTenantId must match --tenantId');
      }
    }

    if (argv.dryRun) {
      console.log(`Running --tenantId=${argv.tenantId} --dry-run --mode=${argv.mode}`);
      const report = await dryRunTenant(prisma, argv.tenantId, argv.mode as 'auto' | 'safe' | 'wipe');
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    if (argv.apply) {
      console.log(`Running --tenantId=${argv.tenantId} --apply --mode=${argv.mode}`);

      const categoriesBefore = await getAllExpenseCategoriesForTenant(prisma, argv.tenantId);
      const categoryIds = categoriesBefore.map((c) => c.id);
      const refCount = await getReferencedExpensesForCategories(prisma, categoryIds);

      let result: ApplyResult;

      if (argv.mode === 'wipe' || (argv.mode === 'auto' && refCount === 0)) {
        console.log('Executing WIPE mode...');
        result = await applyWipe(prisma, argv.tenantId);
      } else {
        console.log('Executing SAFE mode...');
        result = await applySafe(prisma, argv.tenantId);
      }

      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log('No operation specified. Use --dry-run or --apply');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
