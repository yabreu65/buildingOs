import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import {
  ImportExpensesDto,
  ExpenseImportRow,
  ExpenseImportResult,
} from './expense-import.dto';

/**
 * [PHASE 4 HARD #13] ExpenseImportService
 * Handles bulk expense import from Excel/CSV files
 * - Validates all rows before processing
 * - Creates DRAFT expenses for valid rows
 * - Deduplicates vendors (creates if not exists)
 * - Audits all imports
 */
@Injectable()
export class ExpenseImportService {
  private readonly logger = new Logger(ExpenseImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Import expenses from parsed rows
   * Process: validate all → create valid rows → return results with errors
   */
  async importExpensesFromRows(
    tenantId: string,
    buildingId: string,
    period: string,
    rows: ExpenseImportRow[],
    userId: string,
  ): Promise<ExpenseImportResult> {
    const errors: { rowIndex: number; reason: string }[] = [];
    const createdExpenses: string[] = [];

    // Step 1: Validate all rows first (fail-fast)
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const validation = await this.validateRow(
        tenantId,
        buildingId,
        row,
        i,
      );
      if (!validation.valid) {
        errors.push({
          rowIndex: i,
          reason: validation.error || 'Unknown error',
        });
      }
    }

    // Step 2: Process each valid row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const isValid = !errors.some((e) => e.rowIndex === i);

      if (!isValid) {
        continue; // Skip invalid rows (already in error list)
      }

      try {
        // Find category by tenant and name
        const category = await this.prisma.expenseLedgerCategory.findFirst({
          where: {
            tenantId,
            name: row.categoria,
          },
        });

        if (!category) {
          errors.push({
            rowIndex: i,
            reason: `Categoría "${row.categoria}" no encontrada`,
          });
          continue;
        }

        // Get or create vendor
        let vendorId: string | null = null;
        if (row.proveedor) {
          vendorId = await this.getOrCreateVendor(
            tenantId,
            row.proveedor,
          );
        }

        // Parse date
        const invoiceDate = this.parseDateString(row.fecha);

        // Create expense in DRAFT status
        const expense = await this.prisma.expense.create({
          data: {
            tenantId,
            buildingId,
            period,
            categoryId: category.id,
            vendorId,
            scopeType: 'BUILDING',
            description: row.descripcion,
            amountMinor: Math.round(row.monto * 100), // Convert to cents
            currencyCode: row.moneda,
            invoiceDate,
            status: 'DRAFT',
            createdByMembershipId: userId, // Store as membership ID (user importing)
            postedAt: new Date(),
          },
        });

        createdExpenses.push(expense.id);

        // Audit the import
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
          reason:
            error instanceof Error ? error.message : 'Error creando gasto',
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

  /**
   * Validate a single row
   */
  private async validateRow(
    tenantId: string,
    buildingId: string,
    row: ExpenseImportRow,
    index: number,
  ): Promise<{ valid: boolean; error?: string }> {
    // Check required fields
    if (!row.fecha) {
      return { valid: false, error: `Fila ${index}: fecha es requerida` };
    }
    if (!row.descripcion) {
      return {
        valid: false,
        error: `Fila ${index}: descripción es requerida`,
      };
    }
    if (!row.monto || row.monto <= 0) {
      return {
        valid: false,
        error: `Fila ${index}: monto debe ser > 0`,
      };
    }
    if (!row.moneda) {
      return { valid: false, error: `Fila ${index}: moneda es requerida` };
    }
    if (!row.categoria) {
      return { valid: false, error: `Fila ${index}: categoría es requerida` };
    }

    // Validate date format
    try {
      const date = this.parseDateString(row.fecha);
      if (isNaN(date.getTime())) {
        return {
          valid: false,
          error: `Fila ${index}: fecha inválida (esperado DD/MM/YYYY)`,
        };
      }
    } catch (e) {
      return {
        valid: false,
        error: `Fila ${index}: fecha inválida (esperado DD/MM/YYYY)`,
      };
    }

    // Validate category exists
    const category = await this.prisma.expenseLedgerCategory.findFirst({
      where: {
        tenantId,
        name: row.categoria,
      },
    });
    if (!category) {
      return {
        valid: false,
        error: `Fila ${index}: categoría "${row.categoria}" no existe`,
      };
    }

    // Validate building exists and belongs to tenant
    const building = await this.prisma.building.findFirst({
      where: {
        id: buildingId,
        tenantId,
      },
    });
    if (!building) {
      return {
        valid: false,
        error: `Fila ${index}: edificio no encontrado en este tenant`,
      };
    }

    return { valid: true };
  }

  /**
   * Parse date string in DD/MM/YYYY or ISO format
   */
  private parseDateString(dateStr: string): Date {
    // Support DD/MM/YYYY format
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0]!);
      const month = parseInt(parts[1]!);
      const year = parseInt(parts[2]!);
      return new Date(year, month - 1, day);
    }

    // Fallback to ISO format
    return new Date(dateStr);
  }

  /**
   * Get vendor by name or create it if doesn't exist
   */
  private async getOrCreateVendor(
    tenantId: string,
    vendorName: string,
  ): Promise<string> {
    // Normalize name for comparison
    const normalizedName = vendorName.trim().toLowerCase();

    // Try to find existing vendor
    let vendor = await this.prisma.vendor.findFirst({
      where: {
        tenantId,
        name: { equals: vendorName, mode: 'insensitive' },
      },
    });

    // Create if doesn't exist
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
