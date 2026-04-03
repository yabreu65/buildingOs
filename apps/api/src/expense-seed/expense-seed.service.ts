import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import { DEFAULT_LEDGER_CATEGORIES } from './expense-seed.constants';

export interface SeedResult {
  created: number;
  skipped: number;
}

@Injectable()
export class ExpenseLedgerSeedService {
  private readonly logger = new Logger(ExpenseLedgerSeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Seed default expense categories for a tenant.
   * Idempotent: uses createMany with skipDuplicates on (tenantId, code).
   * Called automatically after createTenant() and available via backfill endpoint.
   *
   * @param tenantId - The tenant ID to seed
   * @returns SeedResult with count of created and skipped categories
   */
  async seedDefaultCategoriesForTenant(tenantId: string): Promise<SeedResult> {
    this.logger.debug(`[Seed] Starting for tenant: ${tenantId}`);

    try {
      // Use individual upserts to include catalogScope (not supported in createMany)
      let created = 0;
      let skipped = 0;

      for (const category of DEFAULT_LEDGER_CATEGORIES) {
        const result = await this.prisma.expenseLedgerCategory.upsert({
          where: { tenantId_code: { tenantId, code: category.code } },
          create: {
            tenantId,
            code: category.code,
            name: category.name,
            description: category.description,
            movementType: category.movementType,
            catalogScope: category.catalogScope ?? 'BUILDING',
            sortOrder: category.sortOrder,
            isActive: category.isActive,
          },
          update: {},
        });
        if (result) created++;
        else skipped++;
      }

      this.logger.log(
        `[Seed] Completed for tenant ${tenantId}: created=${created}, skipped=${skipped}`,
      );

      // Fire-and-forget audit log
      void this.auditService.createLog({
        tenantId,
        action: AuditAction.EXPENSE_LEDGER_CATEGORY_CREATE,
        entityType: 'ExpenseLedgerCategory',
        entityId: tenantId,
        metadata: {
          created,
          skipped,
          source: 'DEFAULT_SEED',
          totalCategories: DEFAULT_LEDGER_CATEGORIES.length,
        },
      });

      return {
        created,
        skipped,
      };
    } catch (err) {
      this.logger.error(
        `[Seed] Failed for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  /**
   * Check if a tenant already has seeded categories.
   * Returns true if at least one category with a non-null code exists.
   *
   * @param tenantId - The tenant ID to check
   * @returns true if seeded categories exist, false otherwise
   */
  async hasSeededCategories(tenantId: string): Promise<boolean> {
    const count = await this.prisma.expenseLedgerCategory.count({
      where: {
        tenantId,
        code: { not: null },
      },
    });

    return count > 0;
  }
}
