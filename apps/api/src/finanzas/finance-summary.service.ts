import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { EmailType } from '../email/email.types';

/**
 * [PHASE 4 HARD #15] FinanceSummaryService
 * Generates and emails monthly finance summaries to tenant admins
 * - Called monthly on 1st @ 1am
 * - Generates HTML report for last month
 * - Emails all TENANT_ADMIN members
 */
@Injectable()
export class FinanceSummaryService {
  private readonly logger = new Logger(FinanceSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * [PHASE 4 HARD #15 CRONJOB] Send monthly finance summaries
   * Runs 1st of each month at 1am: generates reports for last month, emails to admins
   */
  async sendMonthlyFinanceSummaries(): Promise<{ sentCount: number }> {
    const lastMonth = this.getLastMonth();
    let sentCount = 0;

    // Get all tenants with their TENANT_ADMIN members
    const tenants = await this.prisma.tenant.findMany({
      include: {
        tenantMembers: {
          where: {
            role: 'TENANT_ADMIN',
            status: 'ACTIVE',
            userId: { not: null },
          },
          include: {
            user: { select: { id: true, email: true } },
          },
        },
      },
    });

    for (const tenant of tenants) {
      const tenantMembers = (tenant as any).tenantMembers;
      if (tenantMembers.length === 0) continue;

      try {
        // Get finance report for last month
        const report = await this.generateFinanceReport(tenant.id, lastMonth);

        // Generate HTML
        const html = this.generateSummaryHtml(tenant.name, lastMonth, report);

        // Send to all TENANT_ADMINs
        for (const membership of (tenant as any).tenantMembers) {
          if (membership.user?.email) {
            try {
              await this.emailService.sendEmail(
                {
                  to: membership.user.email,
                  subject: `${tenant.name} - Resumen Financiero ${this.formatMonth(lastMonth)}`,
                  htmlBody: html,
                  tenantId: tenant.id,
                },
                EmailType.FINANCE_SUMMARY,
              );
              sentCount++;
            } catch (emailError) {
              this.logger.error(
                `Failed to send email to ${membership.user.email} for tenant ${tenant.id}`,
                emailError instanceof Error ? emailError.stack : String(emailError),
              );
            }
          }
        }

        this.logger.log(
          `Finance summary sent to ${tenantMembers.length} admins for tenant ${tenant.id}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to generate/send finance summary for tenant ${tenant.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return { sentCount };
  }

  /**
   * Generate finance report for a tenant in a given period
   */
  private async generateFinanceReport(
    tenantId: string,
    period: string,
  ): Promise<FinanceReport> {
    // Get all charges for period with allocations
    const charges = await this.prisma.charge.findMany({
      where: {
        tenantId,
        liquidationId: { not: null }, // Only published charges
        canceledAt: null,
      },
      include: {
        paymentAllocations: {
          include: { payment: true },
        },
      },
    });

    // Calculate totals using REAL outstanding from allocations
    const totalCharges = charges.reduce((sum, c) => sum + c.amount, 0);
    const totalPaid = charges.reduce((sum, c) => {
      const allocated = c.paymentAllocations.reduce((aSum, pa) => {
        const status = pa.payment?.status;
        if (status === 'APPROVED' || status === 'RECONCILED') {
          return aSum + pa.amount;
        }
        return aSum;
      }, 0);
      return sum + allocated;
    }, 0);
    const totalOutstanding = Math.max(0, totalCharges - totalPaid);
    const collectionRate =
      totalCharges > 0 ? Math.round((totalPaid / totalCharges) * 100) : 0;

    // Get delinquent units (calculate from real allocations, not Charge.status)
    const allCharges = await this.prisma.charge.findMany({
      where: {
        tenantId,
        dueDate: { lt: new Date() },
        canceledAt: null,
      },
      include: {
        unit: {
          select: {
            id: true,
            label: true,
            building: { select: { name: true } },
          },
        },
        paymentAllocations: {
          include: { payment: true },
        },
      },
      orderBy: { amount: 'desc' },
      take: 100,
    });

    // Calculate real outstanding from APPROVED/RECONCILED payments only
    const unitDebtMap = new Map<string, { unit: any; buildingName: string; outstanding: number }>();
    for (const charge of allCharges) {
      const allocatedApproved = charge.paymentAllocations.reduce((sum, pa) => {
        const status = pa.payment?.status;
        if (status === 'APPROVED' || status === 'RECONCILED') {
          return sum + pa.amount;
        }
        return sum;
      }, 0);
      const outstanding = charge.amount - allocatedApproved;

      if (outstanding > 0) {
        const existing = unitDebtMap.get(charge.unitId);
        if (existing) {
          existing.outstanding += outstanding;
        } else {
          unitDebtMap.set(charge.unitId, {
            unit: charge.unit,
            buildingName: charge.unit.building.name,
            outstanding,
          });
        }
      }
    }

    // Sort by outstanding and take top 10
    const delinquentUnits = Array.from(unitDebtMap.values())
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 10)
      .map((item) => ({
        unitId: item.unit.id,
        unitLabel: item.unit.label || 'N/A',
        buildingName: item.buildingName,
        outstanding: item.outstanding,
      }));

    return {
      totalCharges,
      totalPaid,
      totalOutstanding,
      collectionRate,
      delinquentUnitsCount: delinquentUnits.length,
      delinquentUnits,
    };
  }

  /**
   * Generate HTML email template
   */
  private generateSummaryHtml(
    tenantName: string,
    period: string,
    report: FinanceReport,
  ): string {
    const formatCurrency = (cents: number): string =>
      `$${(cents / 100).toFixed(2)}`;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 8px 8px 0 0;
      text-align: center;
    }
    .header h1 { margin: 0; font-size: 24px; }
    .header p { margin: 5px 0 0 0; font-size: 14px; opacity: 0.9; }
    .content {
      background: #f9fafb;
      padding: 30px;
      border: 1px solid #e5e7eb;
    }
    .kpi-container {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20px;
      margin: 20px 0;
    }
    .kpi {
      background: white;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #667eea;
      text-align: center;
    }
    .kpi-label {
      font-size: 12px;
      text-transform: uppercase;
      color: #6b7280;
      font-weight: 600;
      margin-bottom: 10px;
    }
    .kpi-value {
      font-size: 24px;
      font-weight: bold;
      color: #1f2937;
    }
    .kpi.positive { border-left-color: #10b981; }
    .kpi.negative { border-left-color: #ef4444; }
    .section-title {
      font-size: 16px;
      font-weight: 600;
      color: #1f2937;
      margin-top: 30px;
      margin-bottom: 15px;
      border-bottom: 2px solid #667eea;
      padding-bottom: 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border-radius: 8px;
      overflow: hidden;
    }
    th {
      background: #2d3748;
      color: white;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      font-size: 14px;
    }
    td {
      padding: 12px;
      border-bottom: 1px solid #e5e7eb;
    }
    tr:last-child td { border-bottom: none; }
    tr:nth-child(even) { background: #f9fafb; }
    .footer {
      background: #f3f4f6;
      padding: 20px;
      border-radius: 0 0 8px 8px;
      font-size: 12px;
      color: #6b7280;
      text-align: center;
    }
    .no-data {
      text-align: center;
      padding: 40px;
      color: #9ca3af;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${tenantName}</h1>
    <p>Resumen Financiero • ${this.formatMonth(period)}</p>
  </div>

  <div class="content">
    <div class="kpi-container">
      <div class="kpi">
        <div class="kpi-label">Total Facturado</div>
        <div class="kpi-value">${formatCurrency(report.totalCharges)}</div>
      </div>
      <div class="kpi positive">
        <div class="kpi-label">Total Cobrado</div>
        <div class="kpi-value">${formatCurrency(report.totalPaid)}</div>
      </div>
      <div class="kpi ${report.totalOutstanding > 0 ? 'negative' : 'positive'}">
        <div class="kpi-label">Pendiente</div>
        <div class="kpi-value">${formatCurrency(report.totalOutstanding)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Cobranza</div>
        <div class="kpi-value">${report.collectionRate}%</div>
      </div>
    </div>

    ${
      report.delinquentUnitsCount > 0
        ? `
    <div class="section-title">Unidades Morosas (${report.delinquentUnitsCount})</div>
    <table>
      <thead>
        <tr>
          <th>Unidad</th>
          <th>Edificio</th>
          <th style="text-align: right;">Deuda</th>
        </tr>
      </thead>
      <tbody>
        ${report.delinquentUnits
          .map(
            (u) => `
        <tr>
          <td><strong>${u.unitLabel}</strong></td>
          <td>${u.buildingName}</td>
          <td style="text-align: right; font-weight: 600; color: #ef4444;">${formatCurrency(u.outstanding)}</td>
        </tr>
        `,
          )
          .join('')}
      </tbody>
    </table>
    `
        : `
    <div class="section-title">Estado de Cobranza</div>
    <div class="no-data">✓ Sin unidades morosas</div>
    `
    }
  </div>

  <div class="footer">
    <p>Reporte generado automáticamente el ${new Date().toLocaleDateString('es-AR')}.</p>
    <p>Para más detalles, ingresa a BuildingOS.</p>
  </div>
</body>
</html>
    `;
  }

  /**
   * Get last month in YYYY-MM format
   */
  private getLastMonth(): string {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1);
    const year = lastMonth.getFullYear();
    const month = String(lastMonth.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  /**
   * Format period to readable month name (es-AR)
   */
  private formatMonth(period: string): string {
    const parts = period.split('-');
    const year = parseInt(parts[0]!);
    const month = parseInt(parts[1]!);
    const date = new Date(year, month - 1);
    return date.toLocaleDateString('es-AR', {
      month: 'long',
      year: 'numeric',
    });
  }
}

interface FinanceReport {
  totalCharges: number;
  totalPaid: number;
  totalOutstanding: number;
  collectionRate: number;
  delinquentUnitsCount: number;
  delinquentUnits: Array<{
    unitId: string;
    unitLabel: string;
    buildingName: string;
    outstanding: number;
  }>;
}
