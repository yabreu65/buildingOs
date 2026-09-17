import { Injectable, Logger } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { CANONICAL_CURRENCIES, type CanonicalCurrency } from '@buildingos/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  ExpenseImportResult,
  ExpenseImportRow,
} from './expense-import.dto';

interface ValidatedImportRow {
  readonly invoiceDate: Date;
  readonly liquidationPeriod: string;
  readonly amountMinor: number;
  readonly currencyCode: CanonicalCurrency;
}

/**
 * Handles bulk expense import from parsed Excel/CSV rows.
 * Each accepted row creates a BUILDING-scoped DRAFT expense only.
 */
@Injectable()
export class ExpenseImportService {
  private readonly logger = new Logger(ExpenseImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async importExpensesFromRows(
    tenantId: string,
    buildingId: string,
    period: string,
    rows: ExpenseImportRow[],
    userId: string,
  ): Promise<ExpenseImportResult> {
    const errors: { rowIndex: number; reason: string }[] = [];
    const createdExpenses: string[] = [];
    const validatedRows: Array<ValidatedImportRow | null> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const validation = await this.validateRow(tenantId, buildingId, period, row, i);
      if (!validation.valid) {
        errors.push({
          rowIndex: i,
          reason: validation.error ?? 'Unknown error',
        });
        validatedRows.push(null);
        continue;
      }

      validatedRows.push(validation.value);
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const validated = validatedRows[i];
      if (!validated) {
        continue;
      }

      try {
        // Re-read mutable catalog and tenant ownership immediately before the write.
        const [building, category] = await Promise.all([
          this.prisma.building.findFirst({ where: { id: buildingId, tenantId } }),
          this.prisma.expenseLedgerCategory.findFirst({
            where: {
              tenantId,
              name: row.categoria,
              movementType: 'EXPENSE',
              isActive: true,
              catalogScope: 'BUILDING',
            },
          }),
        ]);

        if (!building) {
          throw new Error(`Fila ${i}: edificio no encontrado en este tenant`);
        }
        if (!category) {
          throw new Error(
            `Fila ${i}: categoría "${row.categoria}" no existe o no es válida para gastos de edificio`,
          );
        }

        await this.assertBuildingPeriodIsOpen(tenantId, buildingId, validated.liquidationPeriod);

        const vendorId = row.proveedor
          ? await this.getOrCreateVendor(tenantId, row.proveedor)
          : null;
        const expense = await this.prisma.expense.create({
          data: {
            tenantId,
            buildingId,
            period: validated.liquidationPeriod,
            liquidationPeriod: validated.liquidationPeriod,
            categoryId: category.id,
            vendorId,
            scopeType: 'BUILDING',
            description: row.descripcion,
            amountMinor: validated.amountMinor,
            currencyCode: validated.currencyCode,
            invoiceDate: validated.invoiceDate,
            status: 'DRAFT',
            createdByMembershipId: userId,
          },
        });

        createdExpenses.push(expense.id);
        void this.auditService.createLog({
          tenantId,
          actorUserId: userId,
          action: AuditAction.EXPENSE_IMPORTED,
          entityType: 'Expense',
          entityId: expense.id,
          metadata: {
            source: 'EXCEL_IMPORT',
            rowIndex: i,
            category: category.name,
            vendor: row.proveedor,
          },
        });
      } catch (error) {
        errors.push({
          rowIndex: i,
          reason: error instanceof Error ? error.message : 'Error creando gasto',
        });
        this.logger.error(`Failed to import row ${i}`, error);
      }
    }

    return {
      totalRows: rows.length,
      successCount: createdExpenses.length,
      failureCount: errors.length,
      createdExpenses,
      errors,
    };
  }

  private async validateRow(
    tenantId: string,
    buildingId: string,
    requestedPeriod: string,
    row: ExpenseImportRow,
    index: number,
  ): Promise<{ valid: true; value: ValidatedImportRow } | { valid: false; error: string }> {
    if (!row.fecha) {
      return { valid: false, error: `Fila ${index}: fecha es requerida` };
    }
    if (!row.descripcion) {
      return { valid: false, error: `Fila ${index}: descripción es requerida` };
    }
    if (!row.moneda) {
      return { valid: false, error: `Fila ${index}: moneda es requerida` };
    }
    if (!row.edificio) {
      return { valid: false, error: `Fila ${index}: edificio es requerido` };
    }
    if (this.isTenantSharedBuildingAlias(row.edificio)) {
      return {
        valid: false,
        error: `Fila ${index}: los gastos compartidos requieren allocations y no se pueden importar por esta vía`,
      };
    }
    if (!row.categoria) {
      return { valid: false, error: `Fila ${index}: categoría es requerida` };
    }

    const invoiceDate = this.parseDateString(row.fecha);
    if (!invoiceDate) {
      return { valid: false, error: `Fila ${index}: fecha inválida (esperado DD/MM/YYYY o ISO)` };
    }

    const liquidationPeriod = this.getAccountingPeriodFromInvoiceDate(invoiceDate);
    if (liquidationPeriod !== requestedPeriod) {
      return {
        valid: false,
        error: `Fila ${index}: el período de la factura (${liquidationPeriod}) no coincide con el período solicitado (${requestedPeriod})`,
      };
    }

    const amountMinor = this.parseImportAmountMinor(row.monto);
    if (amountMinor === null) {
      return { valid: false, error: `Fila ${index}: monto debe ser positivo con hasta dos decimales` };
    }

    const currencyCode = row.moneda.toUpperCase().trim();
    if (!CANONICAL_CURRENCIES.includes(currencyCode as CanonicalCurrency)) {
      return { valid: false, error: `Fila ${index}: moneda inválida: ${row.moneda}` };
    }

    const [building, category] = await Promise.all([
      this.prisma.building.findFirst({ where: { id: buildingId, tenantId } }),
      this.prisma.expenseLedgerCategory.findFirst({
        where: {
          tenantId,
          name: row.categoria,
          movementType: 'EXPENSE',
          isActive: true,
          catalogScope: 'BUILDING',
        },
      }),
    ]);
    if (!building) {
      return { valid: false, error: `Fila ${index}: edificio no encontrado en este tenant` };
    }
    if (!category) {
      return {
        valid: false,
        error: `Fila ${index}: categoría "${row.categoria}" no existe o no es válida para gastos de edificio`,
      };
    }

    try {
      await this.assertBuildingPeriodIsOpen(tenantId, buildingId, liquidationPeriod);
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : `Fila ${index}: período publicado`,
      };
    }

    return {
      valid: true,
      value: { invoiceDate, liquidationPeriod, amountMinor, currencyCode: currencyCode as CanonicalCurrency },
    };
  }

  private getAccountingPeriodFromInvoiceDate(invoiceDate: Date): string {
    const year = invoiceDate.getUTCFullYear();
    const month = String(invoiceDate.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  private async assertBuildingPeriodIsOpen(
    tenantId: string,
    buildingId: string,
    liquidationPeriod: string,
  ): Promise<void> {
    const publishedLiquidation = await this.prisma.liquidation.findFirst({
      where: {
        tenantId,
        buildingId,
        period: liquidationPeriod,
        status: 'PUBLISHED',
      },
      select: { id: true },
    });
    if (publishedLiquidation) {
      throw new Error(`El período ${liquidationPeriod} ya está liquidado y publicado`);
    }
  }

  private parseImportAmountMinor(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    const serialized = value.toString();
    if (!/^\d+(?:\.\d{1,2})?$/.test(serialized)) {
      return null;
    }

    const [whole, fraction = ''] = serialized.split('.');
    const amountMinor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(amountMinor) && amountMinor > 0 ? amountMinor : null;
  }

  private isTenantSharedBuildingAlias(building: string): boolean {
    return ['comunes', 'áreas comunes', 'areas comunes', 'tenant_shared', 'tenant shared'].includes(
      building.trim().toLowerCase(),
    );
  }

  private parseDateString(dateStr: string): Date | null {
    const parts = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (parts) {
      const day = Number(parts[1]);
      const month = Number(parts[2]);
      const year = Number(parts[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
        ? date
        : null;
    }

    const parsed = new Date(dateStr);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return new Date(Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ));
  }

  private async getOrCreateVendor(tenantId: string, vendorName: string): Promise<string> {
    let vendor = await this.prisma.vendor.findFirst({
      where: {
        tenantId,
        name: { equals: vendorName, mode: 'insensitive' },
      },
    });

    if (!vendor) {
      vendor = await this.prisma.vendor.create({
        data: {
          tenantId,
          name: vendorName,
          email: '',
          phone: '',
        },
      });
    }

    return vendor.id;
  }
}
