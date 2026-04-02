/**
 * Backfill script: Seed default expense categories for all existing tenants
 *
 * Run with: npx ts-node backfill-expense-categories.ts
 * Or compile and run: npm run build && node dist/backfill-expense-categories.js
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Starting backfill of default expense categories...\n');

  try {
    // Get all tenants
    const tenants = await prisma.tenant.findMany({
      select: { id: name },
      orderBy: { createdAt: 'asc' },
    });

    console.log(`Found ${tenants.length} tenant(s)\n`);

    if (tenants.length === 0) {
      console.log('No tenants found. Exiting.');
      return;
    }

    // For each tenant, seed expense categories
    for (const tenant of tenants) {
      console.log(`\n📦 Seeding tenant: ${tenant.name} (${tenant.id})`);

      // Check if already seeded
      const existingCount = await prisma.expenseLedgerCategory.count({
        where: { tenantId: tenant.id },
      });

      if (existingCount > 0) {
        console.log(
          `   ⏭️  Skipped (already has ${existingCount} categories)`,
        );
        continue;
      }

      // Dynamically import the seed service (hacky but works)
      const ExpenseLedgerSeedService = require('./src/expense-seed/expense-seed.service').ExpenseLedgerSeedService;
      const AuditService = require('./src/audit/audit.service').AuditService;

      // This is a simplified version — in production you'd use dependency injection
      // For now, just insert directly
      const DEFAULT_EXPENSE_CATEGORIES = require('./src/expense-seed/expense-seed.constants').DEFAULT_EXPENSE_CATEGORIES;

      const result = await prisma.expenseLedgerCategory.createMany({
        data: DEFAULT_EXPENSE_CATEGORIES.map((cat: any) => ({
          tenantId: tenant.id,
          code: cat.code,
          name: cat.name,
          description: cat.description,
          sortOrder: cat.sortOrder,
          active: cat.active,
        })),
        skipDuplicates: true,
      });

      console.log(`   ✅ Created ${result.count} categories`);
    }

    console.log('\n✨ Backfill complete!');
  } catch (error) {
    console.error('❌ Error during backfill:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
