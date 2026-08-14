import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { EmailType } from '../email/email.types';
import { calculateChargeOutstandingMinor } from './charge-aggregation';
import {
  aggregateReportBuckets,
  compareReportCurrencies,
  formatCurrencySafe,
  type ReportCurrencyAmountBucket,
} from './currency-buckets';

type ChargeWithUnitAndAllocations = Prisma.ChargeGetPayload<{
  include: {
    unit: {
      select: {
        id: true;
        label: true;
        building: {
          select: {
            name: true;
          };
        };
      };
    };
    paymentAllocations: {
      include: {
        payment: true;
      };
    };
  };
}>;

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

    // Get all TENANT-scoped TENANT_ADMIN memberships grouped by tenant.
    // Roles live on MembershipRole[] (the RBAC source of truth); the
    // parallel TenantMember table is not used here because it is
    // stale/partial for admin roles. The finance summary is tenant-wide, so
    // BUILDING/UNIT-scoped admins must never receive it.
    const memberships = await this.prisma.membership.findMany({
      where: {
        roles: {
          some: { role: 'TENANT_ADMIN', scopeType: 'TENANT' },
        },
      },
      include: {
        tenant: { select: { id: true, name: true } },
        user: { select: { id: true, email: true } },
      },
    });

    const adminsByTenant = new Map<
      string,
      { name: string; admins: Array<{ id: string; email: string | null }> }
    >();
    for (const membership of memberships) {
      const entry = adminsByTenant.get(membership.tenantId);
      if (entry) {
        entry.admins.push(membership.user);
      } else {
        adminsByTenant.set(membership.tenantId, {
          name: membership.tenant.name,
          admins: [membership.user],
        });
      }
    }

    for (const [tenantId, { name: tenantName, admins }] of adminsByTenant) {
      if (admins.length === 0) continue;

      try {
        // Get finance report for last month
        const report = await this.generateFinanceReport(tenantId, lastMonth);

        // Generate HTML
        const html = this.generateSummaryHtml(tenantName, lastMonth, report);

        // Send to all TENANT_ADMINs
        for (const admin of admins) {
          if (admin.email) {
            try {
              await this.emailService.sendEmail(
                {
                  to: admin.email,
                  subject: `${tenantName} - Resumen Financiero ${this.formatMonth(lastMonth)}`,
                  htmlBody: html,
                  tenantId,
                },
                EmailType.FINANCE_SUMMARY,
              );
              sentCount++;
            } catch (emailError) {
              this.logger.error(
                `Failed to send email to ${admin.email} for tenant ${tenantId}`,
                emailError instanceof Error ? emailError.stack : String(emailError),
              );
            }
          }
        }

        this.logger.log(
          `Finance summary sent to ${admins.length} admins for tenant ${tenantId}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to generate/send finance summary for tenant ${tenantId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return { sentCount };
  }

  /**
   * Generate finance report for a tenant in a given period
   *
   * Charge-side, currency-safe: every monetary aggregate is expressed in
   * Charge.currency (integer minor units), grouped into explicit buckets.
   * Currencies are never mixed, converted or summed; canonical currencies
   * come first (USD, VES, ARS, COP), legacy reportable currencies after.
   */
  private async generateFinanceReport(
    tenantId: string,
    period: string,
  ): Promise<FinanceReport> {
    // Get all charges for the requested period with allocations
    // (MONTHLY ACTIVITY: Charge.period is the accrual period authority —
    // YYYY-MM, inherited from Liquidation.period on publication).
    const charges = await this.prisma.charge.findMany({
      where: {
        tenantId,
        period,
        liquidationId: { not: null }, // Only published charges
        canceledAt: null,
      },
      include: {
        paymentAllocations: {
          include: { payment: true },
        },
      },
    });

    // Per-charge accounting (charge-side):
    // - outstanding = charge.amount - effective allocations (clamped >= 0)
    //   (effective = APPROVED | RECONCILED; SUBMITTED never reduces outstanding)
    // - collected = charge.amount - outstanding (bounded by charge.amount)
    const totalsByCurrency = new Map<
      string,
      { charges: number; paid: number; outstanding: number }
    >();

    for (const charge of charges) {
      const outstanding = calculateChargeOutstandingMinor(charge);
      const paid = charge.amount - outstanding;

      const acc = totalsByCurrency.get(charge.currency) ?? {
        charges: 0,
        paid: 0,
        outstanding: 0,
      };
      acc.charges += charge.amount;
      acc.paid += paid;
      acc.outstanding += outstanding;
      totalsByCurrency.set(charge.currency, acc);
    }

    const totalChargesByCurrency = aggregateReportBuckets(
      Array.from(totalsByCurrency.entries(), ([currency, acc]) => ({
        currency,
        amountMinor: acc.charges,
      })),
    );
    const totalPaidByCurrency = aggregateReportBuckets(
      Array.from(totalsByCurrency.entries(), ([currency, acc]) => ({
        currency,
        amountMinor: acc.paid,
      })),
    );
    const totalOutstandingByCurrency = aggregateReportBuckets(
      Array.from(totalsByCurrency.entries(), ([currency, acc]) => ({
        currency,
        amountMinor: acc.outstanding,
      })),
    );

    const collectionRateByCurrency = Array.from(totalsByCurrency.entries())
      .map(([currency, acc]) => ({
        currency,
        rate: acc.charges > 0 ? Math.round((acc.paid / acc.charges) * 100) : 0,
      }))
      .sort((a, b) => compareReportCurrencies(a.currency, b.currency));

    // CURRENT DELINQUENCY SNAPSHOT: overdue unpaid charges regardless of
    // their accrual period (a June debt still unpaid must appear in the
    // July email). No pre-limit: the full overdue set is needed so the
    // delinquent unit count is exact.
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
    });

    // Aggregate per unit with explicit per-currency buckets. Ordering is
    // NON-monetary: earliest delinquency (dueDate ASC), then unitId ASC
    // (3F3 rule) — amounts in different currencies are never compared or
    // summed, and unitLabel is display-only (labels can repeat).
    const unitEntries = new Map<
      string,
      {
        unit: ChargeWithUnitAndAllocations['unit'];
        buildingName: string;
        earliestDue: Date;
        entries: Array<{ currency: string; amountMinor: number }>;
      }
    >();

    for (const charge of allCharges) {
      const outstanding = calculateChargeOutstandingMinor(charge);
      if (outstanding <= 0) continue;

      const existing = unitEntries.get(charge.unitId);
      if (existing) {
        existing.entries.push({ currency: charge.currency, amountMinor: outstanding });
        if (charge.dueDate < existing.earliestDue) {
          existing.earliestDue = charge.dueDate;
        }
      } else {
        unitEntries.set(charge.unitId, {
          unit: charge.unit,
          buildingName: charge.unit.building.name,
          earliestDue: charge.dueDate,
          entries: [{ currency: charge.currency, amountMinor: outstanding }],
        });
      }
    }

    // Exact count over the complete unit map; preview capped at 10.
    const delinquentUnitsCount = unitEntries.size;

    const delinquentUnits = Array.from(unitEntries.values())
      .sort((a, b) => {
        const dueDiff = a.earliestDue.getTime() - b.earliestDue.getTime();
        if (dueDiff !== 0) return dueDiff;
        return a.unit.id.localeCompare(b.unit.id);
      })
      .slice(0, 10)
      .map((item) => ({
        unitId: item.unit.id,
        unitLabel: item.unit.label || 'N/A',
        buildingName: item.buildingName,
        outstandingByCurrency: aggregateReportBuckets(item.entries),
      }));

    return {
      totalChargesByCurrency,
      totalPaidByCurrency,
      totalOutstandingByCurrency,
      collectionRateByCurrency,
      delinquentUnitsCount,
      delinquentUnits,
    };
  }

  /**
   * Generate HTML email template
   *
   * Monetary values are rendered per currency bucket (canonical first,
   * legacy after) using a safe formatter that never throws on malformed
   * historical codes. All interpolated dynamic values (tenant, unit,
   * building, currency) are HTML-escaped.
   */
  private generateSummaryHtml(
    tenantName: string,
    period: string,
    report: FinanceReport,
  ): string {
    const escapeHtml = (value: string): string =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const formatBuckets = (buckets: ReportCurrencyAmountBucket[]): string =>
      buckets.length === 0
        ? '—'
        : buckets
            .map(
              (bucket) =>
                `<div>${escapeHtml(formatCurrencySafe(bucket.amountMinor, bucket.currency))}</div>`,
            )
            .join('');

    const formatRates = (
      rates: FinanceReport['collectionRateByCurrency'],
    ): string =>
      rates.length === 0
        ? '—'
        : rates
            .map(
              (rate) =>
                `<div>${rate.rate}% ${escapeHtml(rate.currency)}</div>`,
            )
            .join('');

    const hasMovements = report.totalChargesByCurrency.length > 0;
    const kpiClass = (buckets: ReportCurrencyAmountBucket[]): string =>
      buckets.some((b) => b.amountMinor > 0) ? 'negative' : 'positive';

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
      font-size: 18px;
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
    <h1>${escapeHtml(tenantName)}</h1>
    <p>Resumen Financiero • ${this.formatMonth(period)}</p>
  </div>

  <div class="content">
    <div class="kpi-container">
      <div class="kpi">
        <div class="kpi-label">Total Facturado</div>
        <div class="kpi-value">${formatBuckets(report.totalChargesByCurrency)}</div>
      </div>
      <div class="kpi positive">
        <div class="kpi-label">Total Cobrado</div>
        <div class="kpi-value">${formatBuckets(report.totalPaidByCurrency)}</div>
      </div>
      <div class="kpi ${hasMovements ? kpiClass(report.totalOutstandingByCurrency) : 'positive'}">
        <div class="kpi-label">Pendiente</div>
        <div class="kpi-value">${formatBuckets(report.totalOutstandingByCurrency)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Cobranza</div>
        <div class="kpi-value">${formatRates(report.collectionRateByCurrency)}</div>
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
          <td><strong>${escapeHtml(u.unitLabel)}</strong></td>
          <td>${escapeHtml(u.buildingName)}</td>
          <td style="text-align: right; font-weight: 600; color: #ef4444;">${formatBuckets(u.outstandingByCurrency)}</td>
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
  totalChargesByCurrency: ReportCurrencyAmountBucket[];
  totalPaidByCurrency: ReportCurrencyAmountBucket[];
  totalOutstandingByCurrency: ReportCurrencyAmountBucket[];
  collectionRateByCurrency: Array<{ currency: string; rate: number }>;
  delinquentUnitsCount: number;
  delinquentUnits: Array<{
    unitId: string;
    unitLabel: string;
    buildingName: string;
    outstandingByCurrency: ReportCurrencyAmountBucket[];
  }>;
}
