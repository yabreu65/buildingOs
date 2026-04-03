import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinanzasValidators } from './finanzas.validators';

@Injectable()
export class VendorPreferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validators: FinanzasValidators,
  ) {}

  async listPreferences(tenantId: string, userRoles: string[]) {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden gestionar preferencias de proveedores');
    }

    const prefs = await this.prisma.expenseCategoryVendorPreference.findMany({
      where: { tenantId },
    });

    const categoryIds = [...new Set(prefs.map(p => p.categoryId))];
    const vendorIds = [...new Set(prefs.map(p => p.vendorId))];

    const [categories, vendors] = await Promise.all([
      this.prisma.expenseLedgerCategory.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true, name: true },
      }),
      this.prisma.vendor.findMany({
        where: { id: { in: vendorIds } },
        select: { id: true, name: true },
      }),
    ]);

    const categoryMap = new Map(categories.map(c => [c.id, c.name]));
    const vendorMap = new Map(vendors.map(v => [v.id, v.name]));

    return prefs.map((p) => ({
      id: p.id,
      categoryId: p.categoryId,
      categoryName: categoryMap.get(p.categoryId) ?? 'Unknown',
      vendorId: p.vendorId,
      vendorName: vendorMap.get(p.vendorId) ?? 'Unknown',
    }));
  }

  async setPreference(
    tenantId: string,
    categoryId: string,
    vendorId: string,
    userRoles: string[],
  ) {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden gestionar preferencias de proveedores');
    }

    const category = await this.prisma.expenseLedgerCategory.findFirst({
      where: { id: categoryId, tenantId },
      select: { name: true },
    });
    if (!category) {
      throw new NotFoundException(`Rubro no encontrado: ${categoryId}`);
    }

    const vendor = await this.prisma.vendor.findFirst({
      where: { id: vendorId, tenantId },
      select: { name: true },
    });
    if (!vendor) {
      throw new NotFoundException(`Proveedor no encontrado: ${vendorId}`);
    }

    const existing = await this.prisma.expenseCategoryVendorPreference.findFirst({
      where: { tenantId, categoryId },
    });

    let preference;
    if (existing) {
      if (existing.vendorId === vendorId) {
        return {
          id: existing.id,
          categoryId: existing.categoryId,
          categoryName: category.name,
          vendorId: existing.vendorId,
          vendorName: vendor.name,
        };
      }
      preference = await this.prisma.expenseCategoryVendorPreference.update({
        where: { id: existing.id },
        data: { vendorId },
      });
    } else {
      preference = await this.prisma.expenseCategoryVendorPreference.create({
        data: { tenantId, categoryId, vendorId },
      });
    }

    return {
      id: preference.id,
      categoryId,
      categoryName: category.name,
      vendorId,
      vendorName: vendor.name,
    };
  }

  async deletePreference(
    tenantId: string,
    categoryId: string,
    userRoles: string[],
  ): Promise<void> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden gestionar preferencias de proveedores');
    }

    const preference = await this.prisma.expenseCategoryVendorPreference.findFirst({
      where: { tenantId, categoryId },
    });

    if (!preference) {
      throw new NotFoundException(`No existe preferencia para este rubro`);
    }

    await this.prisma.expenseCategoryVendorPreference.delete({
      where: { id: preference.id },
    });
  }

  async getVendorSuggestion(
    tenantId: string,
    categoryId: string,
  ) {
    const preference = await this.prisma.expenseCategoryVendorPreference.findFirst({
      where: { tenantId, categoryId },
    });

    if (preference) {
      const vendor = await this.prisma.vendor.findUnique({
        where: { id: preference.vendorId },
        select: { name: true },
      });
      return {
        vendorId: preference.vendorId,
        vendorName: vendor?.name ?? null,
        source: 'PREFERENCE' as const,
      };
    }

    const recentExpense = await this.prisma.expense.findFirst({
      where: {
        tenantId,
        categoryId,
        status: 'VALIDATED',
        vendorId: { not: null },
      },
      orderBy: { validatedAt: 'desc' },
      select: { vendorId: true },
    });

    if (recentExpense?.vendorId) {
      const vendor = await this.prisma.vendor.findUnique({
        where: { id: recentExpense.vendorId },
        select: { name: true },
      });
      return {
        vendorId: recentExpense.vendorId,
        vendorName: vendor?.name ?? null,
        source: 'HISTORY' as const,
      };
    }

    return {
      vendorId: null,
      vendorName: null,
      source: 'NONE' as const,
    };
  }
}
