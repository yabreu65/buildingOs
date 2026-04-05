import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Payment, PaymentAllocation } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BuildingAccessGuard } from '../tenancy/building-access.guard';
import { FinanzasService } from './finanzas.service';
import { ExpenseImportService } from './expense-import.service';
import { AuthenticatedRequest } from '../common/types/request.types';
import {
  CreateChargeDto,
  UpdateChargeDto,
  CancelChargeDto,
  SubmitPaymentDto,
  ApprovePaymentDto,
  RejectPaymentDto,
  RevivePaymentParamDto,
  GetPaymentParamDto,
  CancelPaymentParamDto,
  CancelPaymentDto,
  CreateAllocationDto,
  ListChargesQueryDto,
  ListPaymentsQueryDto,
  GetChargeParamDto,
  UpdateChargeParamDto,
  DeleteChargeParamDto,
  ListChargesParamDto,
  CreateChargeParamDto,
  ListPaymentsParamDto,
  CreatePaymentParamDto,
  ApprovePaymentParamDto,
  RejectPaymentParamDto,
  CreateAllocationParamDto,
  DeleteAllocationParamDto,
  GetPaymentAllocationsParamDto,
  FinancialSummaryParamDto,
  FinancialSummaryQueryDto,
  ChargeDetailDto,
  PaymentDetailDto,
  FinancialSummaryDto,
  FinanceTrendQueryDto,
  MonthlyTrendDto,
} from './finanzas.dto';
import {
  ImportExpensesDto,
  ExpenseImportRow,
  ExpenseImportResult,
} from './expense-import.dto';

/**
 * FinanzasController: Charges, Payments, and Allocations management
 *
 * Routes: /buildings/:buildingId/charges, /payments, /allocations
 *
 * Security:
 * 1. JwtAuthGuard: Requires valid JWT token
 * 2. BuildingAccessGuard: Validates building belongs to user's tenant
 *    - Populates req.tenantId automatically
 * 3. Service layer validates charge/payment/allocation scope
 * 4. RESIDENT role scope enforcement: RESIDENT can only access charges/payments from units they're assigned to
 *
 * RBAC Permissions:
 * - finance.read: View charges/payments/allocations
 * - finance.charge.write: Create/edit/cancel charges (admin/operator only)
 * - finance.payment.submit: Submit payments (all authenticated)
 * - finance.payment.review: Approve/reject payments (admin/operator only)
 * - finance.allocate: Create allocations (admin/operator only)
 */
@Controller('buildings/:buildingId')
@UseGuards(JwtAuthGuard, BuildingAccessGuard)
export class FinanzasController {
  constructor(
    private finanzasService: FinanzasService,
    private expenseImportService: ExpenseImportService,
  ) {}

  // ============================================================================
  // CHARGES ENDPOINTS
  // ============================================================================

  /**
   * POST /buildings/:buildingId/charges
   * Create a new charge (admin/operator only)
   */
  @Post('charges')
  async createCharge(
    @Param() params: CreateChargeParamDto,
    @Body() dto: CreateChargeDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ChargeDetailDto> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.finanzasService.createCharge(
      tenantId,
      params.buildingId,
      userRoles,
      userId,
      dto,
    );
  }

  /**
   * GET /buildings/:buildingId/charges
   * List charges with filters (period, status, unitId)
   *
   * RESIDENT/OWNER: filtered to their units only
   * Admin/Operator: all building charges
   */
  @Get('charges')
  async listCharges(
    @Param() params: ListChargesParamDto,
    @Query() query: ListChargesQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ChargeDetailDto[]> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.finanzasService.listCharges(
      tenantId,
      params.buildingId,
      userRoles,
      userId,
      query,
    );
  }

  /**
   * GET /buildings/:buildingId/charges/:chargeId
   * Get charge detail
   *
   * RESIDENT/OWNER: only if it's their unit (404 otherwise)
   */
  @Get('charges/:chargeId')
  async getCharge(
    @Param() params: GetChargeParamDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ChargeDetailDto> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.finanzasService.getCharge(
      tenantId,
      params.buildingId,
      params.chargeId,
      userRoles,
      userId,
    );
  }

  /**
   * PATCH /buildings/:buildingId/charges/:chargeId
   * Update a charge (admin/operator only)
   *
   * Cannot update if payment allocations exist
   */
  @Patch('charges/:chargeId')
  async updateCharge(
    @Param() params: UpdateChargeParamDto,
    @Body() dto: UpdateChargeDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ChargeDetailDto> {
    const tenantId = req.tenantId!;
    const userRoles = req.user.roles || [];
    return this.finanzasService.updateCharge(
      tenantId,
      params.buildingId,
      params.chargeId,
      userRoles,
      dto,
    );
  }

  /**
   * DELETE /buildings/:buildingId/charges/:chargeId
   * Cancel a charge (soft delete, admin/operator only)
   */
  @Delete('charges/:chargeId')
  async cancelCharge(
    @Param() params: DeleteChargeParamDto,
    @Body() dto: CancelChargeDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ChargeDetailDto> {
    const tenantId = req.tenantId!;
    const userRoles = req.user.roles || [];
    const userId = req.user.sub!;
    return this.finanzasService.cancelCharge(
      tenantId,
      params.buildingId,
      params.chargeId,
      userRoles,
      userId,
      dto,
    );
  }

  // ============================================================================
  // PAYMENTS ENDPOINTS
  // ============================================================================

  /**
   * POST /buildings/:buildingId/payments
   * Submit a payment (resident or admin)
   *
   * RESIDENT: can only submit for their own units (unitId required)
   * ADMIN: can submit for any unit
   */
  @Post('payments')
  async submitPayment(
    @Param() params: CreatePaymentParamDto,
    @Body() dto: SubmitPaymentDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<PaymentDetailDto> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.finanzasService.submitPayment(
      tenantId,
      params.buildingId,
      userId,
      userRoles,
      dto,
    );
  }

  /**
   * GET /buildings/:buildingId/payments
   * List payments with filters (status, unitId)
   *
   * RESIDENT/OWNER: filtered to their units or their submissions
   * Admin/Operator: all building payments
   */
  @Get('payments')
  async listPayments(
    @Param() params: ListPaymentsParamDto,
    @Query() query: ListPaymentsQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<PaymentDetailDto[]> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.finanzasService.listPayments(
      tenantId,
      params.buildingId,
      userRoles,
      userId,
      query,
    );
  }

  /**
   * PATCH /buildings/:buildingId/payments/:paymentId/approve
   * Approve a payment (admin/operator only)
   */
  @Patch('payments/:paymentId/approve')
  async approvePayment(
    @Param() params: ApprovePaymentParamDto,
    @Body() dto: ApprovePaymentDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<PaymentDetailDto> {
    const tenantId = req.tenantId!;
    const membershipId = req.user.membershipId!;
    const userRoles = req.user.roles || [];
    return this.finanzasService.approvePayment(
      tenantId,
      params.buildingId,
      params.paymentId,
      userRoles,
      membershipId,
      dto,
    );
  }

  /**
   * PATCH /buildings/:buildingId/payments/:paymentId/reject
   * Reject a payment (admin/operator only)
   */
  @Patch('payments/:paymentId/reject')
  async rejectPayment(
    @Param() params: RejectPaymentParamDto,
    @Body() dto: RejectPaymentDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<PaymentDetailDto> {
    const tenantId = req.tenantId!;
    const membershipId = req.user.membershipId!;
    const userRoles = req.user.roles || [];
    return this.finanzasService.rejectPayment(
      tenantId,
      params.buildingId,
      params.paymentId,
      userRoles,
      membershipId,
      dto,
    );
  }

  /**
   * PATCH /buildings/:buildingId/payments/:paymentId/revive
   * Revive a rejected payment (REJECTED → SUBMITTED)
   */
  @Patch('payments/:paymentId/revive')
  async revivePayment(
    @Param() params: RevivePaymentParamDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<PaymentDetailDto> {
    const tenantId = req.tenantId!;
    const membershipId = req.user.membershipId!;
    const userRoles = req.user.roles || [];
    return this.finanzasService.revivePayment(
      tenantId,
      params.buildingId,
      params.paymentId,
      userRoles,
      membershipId,
    ) as Promise<PaymentDetailDto>;
  }

  /**
   * GET /buildings/:buildingId/payments/:paymentId
   * Get a single payment with allocations
   *
   * RESIDENT/OWNER: only if it's their unit (404 otherwise)
   */
  @Get('payments/:paymentId')
  async getPayment(
    @Param() params: GetPaymentParamDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<PaymentDetailDto> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.finanzasService.getPayment(
      tenantId,
      params.buildingId,
      params.paymentId,
      userRoles,
      userId,
    ) as Promise<PaymentDetailDto>;
  }

  /**
   * DELETE /buildings/:buildingId/payments/:paymentId
   * Cancel a payment (soft delete via canceledAt, admin/operator only)
   */
  @Delete('payments/:paymentId')
  async cancelPayment(
    @Param() params: CancelPaymentParamDto,
    @Body() dto: CancelPaymentDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<PaymentDetailDto> {
    const tenantId = req.tenantId!;
    const membershipId = req.user.membershipId!;
    const userRoles = req.user.roles || [];
    return this.finanzasService.cancelPayment(
      tenantId,
      params.buildingId,
      params.paymentId,
      userRoles,
      membershipId,
      dto.reason,
    ) as Promise<PaymentDetailDto>;
  }

  // ============================================================================
  // ALLOCATIONS ENDPOINTS
  // ============================================================================

  /**
   * POST /buildings/:buildingId/allocations
   * Create a payment allocation (admin/operator only)
   *
   * Links a payment to a charge with a specific amount.
   * Automatically recalculates charge status.
   */
  @Post('allocations')
  async createAllocation(
    @Param() params: CreateAllocationParamDto,
    @Body() dto: CreateAllocationDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<{ id: string }> {
    const tenantId = req.tenantId!;
    const userRoles = req.user.roles || [];
    const membershipId = req.user.membershipId!;
    return this.finanzasService.createAllocation(
      tenantId,
      params.buildingId,
      userRoles,
      membershipId,
      dto,
    );
  }

  /**
   * DELETE /buildings/:buildingId/allocations/:allocationId
   * Delete a payment allocation (admin/operator only)
   *
   * Automatically recalculates charge status.
   */
  @Delete('allocations/:allocationId')
  async deleteAllocation(
    @Param() params: DeleteAllocationParamDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    const tenantId = req.tenantId!;
    const userRoles = req.user.roles || [];
    const membershipId = req.user.membershipId!;
    await this.finanzasService.deleteAllocation(
      tenantId,
      params.buildingId,
      params.allocationId,
      userRoles,
      membershipId,
    );
  }

  /**
   * GET /buildings/:buildingId/payments/:paymentId/allocations
   * List allocations for a payment
   */
  @Get('payments/:paymentId/allocations')
  async getPaymentAllocations(
    @Param() params: GetPaymentAllocationsParamDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<Array<{ id: string; paymentId: string; chargeId: string; amount: number }>> {
    const tenantId = req.tenantId!;
    return this.finanzasService.getPaymentAllocations(
      tenantId,
      params.buildingId,
      params.paymentId,
    );
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  /**
   * PATCH /buildings/:buildingId/expenses/validate-all?periodId=
   * Validate all DRAFT expenses for a building (optionally filtered by period)
   * Only admins/operators can perform this action
   *
   * Returns: { validatedCount, errorCount }
   */
  @Patch('expenses/validate-all')
  @UseGuards(JwtAuthGuard, BuildingAccessGuard)
  async bulkValidateExpenses(
    @Param('buildingId') buildingId: string,
    @Query('periodId') periodId?: string,
    @Request() req?: AuthenticatedRequest,
  ) {
    const tenantId = req!.tenantId!;
    const userRoles = req!.user?.roles || [];

    // Only TENANT_ADMIN, TENANT_OWNER, OPERATOR can validate
    if (
      !['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'].some((role) =>
        userRoles.includes(role),
      )
    ) {
      throw new ForbiddenException(
        'Solo administradores pueden validar gastos en lote',
      );
    }

    return this.finanzasService.bulkValidateExpenses(
      tenantId,
      buildingId,
      periodId,
    );
  }

  /**
   * POST /buildings/:buildingId/expenses/import
   * Import expenses from Excel/CSV file
   * Expects parsed rows in request body with period
   *
   * Returns: { totalRows, successCount, failureCount, createdExpenses, errors }
   */
  @Post('expenses/import')
  async importExpenses(
    @Param('buildingId') buildingId: string,
    @Body() importDto: ImportExpensesDto & { rows: ExpenseImportRow[] },
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpenseImportResult> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user?.roles || [];

    // Only TENANT_ADMIN, TENANT_OWNER, OPERATOR can import
    if (
      !['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'].some((role) =>
        userRoles.includes(role),
      )
    ) {
      throw new ForbiddenException(
        'Solo administradores pueden importar gastos',
      );
    }

    if (!importDto.rows || !Array.isArray(importDto.rows)) {
      throw new BadRequestException('rows array is required');
    }

    return this.expenseImportService.importExpensesFromRows(
      tenantId,
      buildingId,
      importDto.period,
      importDto.rows,
      userId,
    );
  }

  // ============================================================================
  // SUMMARY & REPORTING ENDPOINTS
  // ============================================================================

  /**
   * GET /buildings/:buildingId/finance/summary?period=
   * Get financial summary for building
   *
   * Returns:
   * - totalCharges, totalPaid, totalOutstanding
   * - delinquentUnitsCount
   * - topDelinquentUnits
   */
  @Get('finance/summary')
  async getBuildingFinancialSummary(
    @Param() params: FinancialSummaryParamDto,
    @Query() query: FinancialSummaryQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<FinancialSummaryDto> {
    const tenantId = req.tenantId!;
    return this.finanzasService.getBuildingFinancialSummary(
      tenantId,
      params.buildingId,
      query.period || undefined,
    );
  }

  /**
   * GET /buildings/:buildingId/finance/trend?months=6
   * Get monthly trend of charges, payments, outstanding, collection rate
   */
  @Get('finance/trend')
  async getFinanceTrend(
    @Param() params: FinancialSummaryParamDto,
    @Query() query: FinanceTrendQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<MonthlyTrendDto[]> {
    const tenantId = req.tenantId!;
    return this.finanzasService.getFinanceTrend(
      tenantId,
      params.buildingId,
      query.months || 6,
    );
  }
}
