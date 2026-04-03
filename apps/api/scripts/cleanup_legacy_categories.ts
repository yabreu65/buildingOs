import { PrismaClient } from '@prisma/client';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

interface DryRunReport {
  tenantId: string;
  tenantName: string | null;
  legacyCategoriesToDeleteCount: number;
  expensesReferencingLegacyCount: number;
  expRemainingCount: number;
  ccRemainingCount: number;
}

interface ApplyResult {
  tenantId: string;
  tenantName: string | null;
  deletedLegacyCategoriesCount: number;
  deletedLegacyExpensesCount: number;
  remainingExpCategoriesCount: number;
  remainingCcCategoriesCount: number;
  errors: string[];
}

const LEGACY_PREFIXES = ['SERV_', 'MANT_', 'INF_', 'ADM_', 'PROT_', 'PERS_', 'FONDO_'];
const EXP_PREFIX = 'EXP_';
const CC_PREFIX = 'CC_';

function isLegacyCode(code: string | null): boolean {
  if (!code) return false;
  return LEGACY_PREFIXES.some(prefix => code.startsWith(prefix));
}

function isExpCode(code: string | null): boolean {
  if (!code) return false;
  return code.startsWith(EXP_PREFIX);
}

function isCcCode(code: string | null): boolean {
  if (!code) return false;
  return code.startsWith(CC_PREFIX);
}

async function getCategoriesByScope(
  prisma: PrismaClient,
  tenantId: string
) {
  const categories = await prisma.expenseLedgerCategory.findMany({
    where: { tenantId, movementType: 'EXPENSE' },
    select: { id: true, code: true, name: true },
  });

  const legacy = categories.filter(c => isLegacyCode(c.code));
  const exp = categories.filter(c => isExpCode(c.code));
  const cc = categories.filter(c => isCcCode(c.code));

  return { legacy, exp, cc };
}

async function dryRunAllTenants(prisma: PrismaClient): Promise<DryRunReport[]> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  const reports: DryRunReport[] = [];

  for (const tenant of tenants) {
    const { legacy, exp, cc } = await getCategoriesByScope(prisma, tenant.id);
    
    const legacyIds = legacy.map(c => c.id);
    const expensesRefLegacy = legacyIds.length > 0
      ? await prisma.expense.count({
          where: { tenantId: tenant.id, categoryId: { in: legacyIds } },
        })
      : 0;

    reports.push({
      tenantId: tenant.id,
      tenantName: tenant.name,
      legacyCategoriesToDeleteCount: legacy.length,
      expensesReferencingLegacyCount: expensesRefLegacy,
      expRemainingCount: exp.length,
      ccRemainingCount: cc.length,
    });
  }

  return reports;
}

async function applyCleanupAllTenants(prisma: PrismaClient): Promise<ApplyResult[]> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  const results: ApplyResult[] = [];

  for (const tenant of tenants) {
    const result: ApplyResult = {
      tenantId: tenant.id,
      tenantName: tenant.name,
      deletedLegacyCategoriesCount: 0,
      deletedLegacyExpensesCount: 0,
      remainingExpCategoriesCount: 0,
      remainingCcCategoriesCount: 0,
      errors: [],
    };

    try {
      const { legacy, exp, cc } = await getCategoriesByScope(prisma, tenant.id);
      
      result.remainingExpCategoriesCount = exp.length;
      result.remainingCcCategoriesCount = cc.length;

      if (legacy.length === 0) {
        results.push(result);
        continue;
      }

      const legacyIds = legacy.map(c => c.id);

      // Delete expenses referencing legacy categories first
      const deleteExpenses = await prisma.expense.deleteMany({
        where: { tenantId: tenant.id, categoryId: { in: legacyIds } },
      });
      result.deletedLegacyExpensesCount = deleteExpenses.count;

      // Delete legacy categories
      const deleteCategories = await prisma.expenseLedgerCategory.deleteMany({
        where: { tenantId: tenant.id, id: { in: legacyIds } },
      });
      result.deletedLegacyCategoriesCount = deleteCategories.count;

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      result.errors.push(errMsg);
      console.error(`[${tenant.name}] ERROR: ${errMsg}`);
    }

    results.push(result);
  }

  return results;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const isAllTenants = rawArgs.includes('--all-tenants');
  const isDryRun = rawArgs.includes('--dry-run');
  const isApply = rawArgs.includes('--apply');

  const argv = await yargs(hideBin(process.argv))
    .option('all-tenants', {
      type: 'boolean',
      description: 'Run on all tenants',
      default: false,
    })
    .option('dry-run', {
      type: 'boolean',
      description: 'Dry-run mode (read-only)',
      default: false,
    })
    .option('apply', {
      type: 'boolean',
      description: 'Apply changes',
      default: false,
    })
    .option('confirm', {
      type: 'string',
      description: 'Confirmation string required for apply',
    })
    .argv;

  const prisma = new PrismaClient();

  try {
    if (isDryRun && !isApply) {
      console.log('Running --all-tenants --dry-run');
      const reports = await dryRunAllTenants(prisma);
      console.log(JSON.stringify(reports, null, 2));
      return;
    }

    if (isApply) {
      if (!argv.confirm) {
        throw new Error('--apply requires --confirm=CLEANUP_LEGACY_CATEGORIES_DEV');
      }
      if (argv.confirm !== 'CLEANUP_LEGACY_CATEGORIES_DEV') {
        throw new Error('--confirm must be CLEANUP_LEGACY_CATEGORIES_DEV');
      }

      console.log('Running --all-tenants --apply');
      const results = await applyCleanupAllTenants(prisma);
      
      console.log('\n=== FINAL REPORT ===');
      console.log(JSON.stringify(results, null, 2));
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
