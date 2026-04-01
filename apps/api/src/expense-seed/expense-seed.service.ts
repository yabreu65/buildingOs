import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import { DEFAULT_EXPENSE_CATEGORIES } from './expense-seed.constants';

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
      // Use createMany with skipDuplicates for idempotence and atomicity
      const result = await this.prisma.expenseLedgerCategory.createMany({
        data: DEFAULT_EXPENSE_CATEGORIES.map((category) => ({
          tenantId,
          code: category.code,
          name: category.name,
          description: category.description,
          sortOrder: category.sortOrder,
          active: category.active,
        })),
        skipDuplicates: true,
      });

      const skipped = DEFAULT_EXPENSE_CATEGORIES.length - result.count;

      this.logger.log(
        `[Seed] Completed for tenant ${tenantId}: created=${result.count}, skipped=${skipped}`,
      );

      // Fire-and-forget audit log
      void this.auditService.createLog({
        tenantId,
        action: AuditAction.EXPENSE_LEDGER_CATEGORY_CREATE,
        entityType: 'ExpenseLedgerCategory',
        entityId: tenantId,
        metadata: {
          created: result.count,
          skipped,
          source: 'DEFAULT_SEED',
          totalCategories: DEFAULT_EXPENSE_CATEGORIES.length,
        },
      });

      return {
        created: result.count,
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
