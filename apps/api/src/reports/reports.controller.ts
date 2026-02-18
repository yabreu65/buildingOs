import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Request,
  Response,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { RequireFeatureGuard, RequireFeature } from '../billing/require-feature.guard';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import { ReportsService } from './reports.service';
import { ReportsValidators } from './reports.validators';

/**
 * ReportsController: Reports endpoints for admins
 *
 * All endpoints require:
 * - JWT authentication (JwtAuthGuard)
 * - Tenant membership (TenantAccessGuard)
 * - Admin role (TENANT_ADMIN, TENANT_OWNER, OPERATOR)
 *
 * Routes:
 * - GET /tenants/:tenantId/reports/tickets
 * - GET /tenants/:tenantId/reports/finance
 * - GET /tenants/:tenantId/reports/communications
 * - GET /tenants/:tenantId/reports/activity
 */
@Controller('tenants')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly validators: ReportsValidators,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Extract user roles for the given tenant from JWT memberships
   */
  private getUserRoles(req: any, tenantId: string): string[] {
    // memberships is array [{tenantId, roles[]}] from JwtStrategy.validate()
    const membership = req.user?.memberships?.find(
      (m: any) => m.tenantId === tenantId
    );
    return membership?.roles || [];
  }

  /**
   * GET /tenants/:tenantId/reports/tickets
   *
   * Returns:
   * - byStatus: Tickets grouped by status (OPEN, IN_PROGRESS, RESOLVED, CLOSED)
   * - byPriority: Tickets grouped by priority (LOW, MEDIUM, HIGH, URGENT)
   * - topCategories: Top 5 ticket categories by count
   * - avgTimeToFirstResponseHours: Average response time in hours
   * - avgTimeToResolveHours: Average resolution time in hours
   */
  @Get(':tenantId/reports/tickets')
  async getTicketsReport(
    @Param('tenantId') tenantId: string,
    @Query('buildingId') buildingId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Request() req?: any
  ) {
    const userRoles = this.getUserRoles(req, tenantId);
    if (!this.validators.canReadReports(userRoles)) {
      this.validators.throwForbidden();
    }

    await this.validators.validateBuildingScope(tenantId, buildingId);

    return this.reportsService.getTicketsReport(tenantId, {
      buildingId,
      from: this.validators.parseDate(from),
      to: this.validators.parseDate(to),
    });
  }

  /**
   * GET /tenants/:tenantId/reports/finance
   *
   * Returns:
   * - totalCharges: Sum of all non-canceled charges (in cents)
   * - totalPaid: Sum of APPROVED payments allocated (in cents)
   * - totalOutstanding: totalCharges - totalPaid (in cents)
   * - delinquentUnitsCount: Count of units with past-due charges
   * - delinquentUnits: Top 10 delinquent units with outstanding amounts (in cents)
   * - collectionRate: Percentage of charges paid (0-100)
   * - currency: Currency code (ARS)
   */
  @Get(':tenantId/reports/finance')
  async getFinanceReport(
    @Param('tenantId') tenantId: string,
    @Query('buildingId') buildingId?: string,
    @Query('period') period?: string,
    @Request() req?: any
  ) {
    const userRoles = this.getUserRoles(req, tenantId);
    if (!this.validators.canReadReports(userRoles)) {
      this.validators.throwForbidden();
    }

    await this.validators.validateBuildingScope(tenantId, buildingId);

    return this.reportsService.getFinanceReport(tenantId, {
      buildingId,
      period,
    });
  }

  /**
   * GET /tenants/:tenantId/reports/communications
   *
   * Returns:
   * - totalRecipients: Total number of message recipients
   * - totalRead: Total number of recipients who read
   * - readRate: Percentage of recipients who read (0-100)
   * - byChannel: Array of channels with sent/read counts and rates
   */
  @Get(':tenantId/reports/communications')
  async getCommunicationsReport(
    @Param('tenantId') tenantId: string,
    @Query('buildingId') buildingId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Request() req?: any
  ) {
    const userRoles = this.getUserRoles(req, tenantId);
    if (!this.validators.canReadReports(userRoles)) {
      this.validators.throwForbidden();
    }

    await this.validators.validateBuildingScope(tenantId, buildingId);

    return this.reportsService.getCommunicationsReport(tenantId, {
      buildingId,
      from: this.validators.parseDate(from),
      to: this.validators.parseDate(to),
    });
  }

  /**
   * GET /tenants/:tenantId/reports/activity
   *
   * Returns:
   * - ticketsCreated: Number of tickets created
   * - paymentsSubmitted: Number of payments submitted
   * - documentsUploaded: Number of documents uploaded
   * - communicationsSent: Number of communications sent
   */
  @Get(':tenantId/reports/activity')
  async getActivityReport(
    @Param('tenantId') tenantId: string,
    @Query('buildingId') buildingId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Request() req?: any
  ) {
    const userRoles = this.getUserRoles(req, tenantId);
    if (!this.validators.canReadReports(userRoles)) {
      this.validators.throwForbidden();
    }

    await this.validators.validateBuildingScope(tenantId, buildingId);

    return this.reportsService.getActivityReport(tenantId, {
      buildingId,
      from: this.validators.parseDate(from),
      to: this.validators.parseDate(to),
    });
  }

  /**
   * GET /tenants/:tenantId/reports/tickets/export.csv
   * Export tickets to CSV format
   *
   * Query parameters:
   * - buildingId: Optional, filter by building
   * - from: Optional, ISO date start (YYYY-MM-DD)
   * - to: Optional, ISO date end (YYYY-MM-DD)
   *
   * Returns CSV attachment with headers and data rows
   *
   * Errors:
   * - 403: Feature not available (FREE plan)
   * - 413: Export exceeds 10k rows (EXPORT_TOO_LARGE)
   */
  @Get(':tenantId/reports/tickets/export.csv')
  @UseGuards(RequireFeatureGuard)
  @RequireFeature('canExportReports')
  async exportTickets(
    @Param('tenantId') tenantId: string,
    @Query('buildingId') buildingId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Response() res?: any,
    @Request() req?: any,
  ) {
    const userRoles = this.getUserRoles(req, tenantId);
    if (!this.validators.canReadReports(userRoles)) {
      this.validators.throwForbidden();
    }

    await this.validators.validateBuildingScope(tenantId, buildingId);

    const result = await this.reportsService.exportTickets(tenantId, {
      buildingId,
      from: this.validators.parseDate(from),
      to: this.validators.parseDate(to),
    });

    // Audit log
    void this.auditService.createLog({
      tenantId,
      actorUserId: req.user.id,
      action: AuditAction.REPORT_EXPORTED,
      entityType: 'Report',
      entityId: 'tickets',
      metadata: {
        reportType: 'tickets',
        buildingId,
        from,
        to,
        rows: result.rows,
        format: 'csv',
      },
    });

    // Set CSV response headers
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);
  }

  /**
   * GET /tenants/:tenantId/reports/finance/export.csv
   * Export finance report to CSV format (includes delinquent units)
   *
   * Query parameters:
   * - buildingId: Optional, filter by building
   * - period: Optional, time period (monthly, quarterly, yearly)
   *
   * Returns CSV attachment with summary + delinquent units
   */
  @Get(':tenantId/reports/finance/export.csv')
  @UseGuards(RequireFeatureGuard)
  @RequireFeature('canExportReports')
  async exportFinance(
    @Param('tenantId') tenantId: string,
    @Query('buildingId') buildingId?: string,
    @Query('period') period?: string,
    @Response() res?: any,
    @Request() req?: any,
  ) {
    const userRoles = this.getUserRoles(req, tenantId);
    if (!this.validators.canReadReports(userRoles)) {
      this.validators.throwForbidden();
    }

    await this.validators.validateBuildingScope(tenantId, buildingId);

    const result = await this.reportsService.exportFinance(tenantId, {
      buildingId,
      period,
    });

    // Audit log
    void this.auditService.createLog({
      tenantId,
      actorUserId: req.user.id,
      action: AuditAction.REPORT_EXPORTED,
      entityType: 'Report',
      entityId: 'finance',
      metadata: {
        reportType: 'finance',
        buildingId,
        period,
        rows: result.rows,
        format: 'csv',
      },
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);
  }

  /**
   * GET /tenants/:tenantId/reports/payments/export.csv
   * Export payments to CSV format
   * Note: This exports tenant payments (Phase 6), not SaaS subscription payments
   *
   * Query parameters:
   * - buildingId: Optional, filter by building
   * - from: Optional, ISO date start (YYYY-MM-DD)
   * - to: Optional, ISO date end (YYYY-MM-DD)
   * - status: Optional, filter by payment status (PENDING, APPROVED, REJECTED)
   */
  @Get(':tenantId/reports/payments/export.csv')
  @UseGuards(RequireFeatureGuard)
  @RequireFeature('canExportReports')
  async exportPayments(
    @Param('tenantId') tenantId: string,
    @Query('buildingId') buildingId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Response() res?: any,
    @Request() req?: any,
  ) {
    const userRoles = this.getUserRoles(req, tenantId);
    if (!this.validators.canReadReports(userRoles)) {
      this.validators.throwForbidden();
    }

    await this.validators.validateBuildingScope(tenantId, buildingId);

    const result = await this.reportsService.exportPayments(tenantId, {
      buildingId,
      from: this.validators.parseDate(from),
      to: this.validators.parseDate(to),
      status,
    });

    // Audit log
    void this.auditService.createLog({
      tenantId,
      actorUserId: req.user.id,
      action: AuditAction.REPORT_EXPORTED,
      entityType: 'Report',
      entityId: 'payments',
      metadata: {
        reportType: 'payments',
        buildingId,
        from,
        to,
        status,
        rows: result.rows,
        format: 'csv',
      },
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);
  }
}
