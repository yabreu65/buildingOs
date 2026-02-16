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
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BuildingAccessGuard } from '../tenancy/building-access.guard';
import { FinanzasService } from './finanzas.service';
import { FinanzasValidators } from './finanzas.validators';
import {
  CreateChargeDto,
  UpdateChargeDto,
  CancelChargeDto,
  SubmitPaymentDto,
  ApprovePaymentDto,
  RejectPaymentDto,
  CreateAllocationDto,
  ListChargesQueryDto,
  ListPaymentsQueryDto,
} from './finanzas.dto';

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
    private validators: FinanzasValidators,
  ) {}

  private isResidentOrOwner(userRoles: string[]): boolean {
    return this.validators.isResidentOrOwner(userRoles);
  }

  // ============================================================================
  // CHARGES ENDPOINTS
  // ============================================================================

  /**
   * POST /buildings/:buildingId/charges
   * Create a new charge (admin/operator only)
   */
  @Post('charges')
  async createCharge(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateChargeDto,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.finanzasService.createCharge(
      tenantId,
      buildingId,
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
    @Param('buildingId') buildingId: string,
    @Query() query: ListChargesQueryDto,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.finanzasService.listCharges(
      tenantId,
      buildingId,
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
    @Param('buildingId') buildingId: string,
    @Param('chargeId') chargeId: string,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.finanzasService.getCharge(
      tenantId,
      buildingId,
      chargeId,
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
    @Param('buildingId') buildingId: string,
    @Param('chargeId') chargeId: string,
    @Body() dto: UpdateChargeDto,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const userRoles = req.user.roles || [];
    return this.finanzasService.updateCharge(
      tenantId,
      buildingId,
      chargeId,
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
    @Param('buildingId') buildingId: string,
    @Param('chargeId') chargeId: string,
    @Body() dto: CancelChargeDto,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const userRoles = req.user.roles || [];
    return this.finanzasService.cancelCharge(
      tenantId,
      buildingId,
      chargeId,
      userRoles,
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
    @Param('buildingId') buildingId: string,
    @Body() dto: SubmitPaymentDto,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.finanzasService.submitPayment(
      tenantId,
      buildingId,
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
    @Param('buildingId') buildingId: string,
    @Query() query: ListPaymentsQueryDto,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.finanzasService.listPayments(
      tenantId,
      buildingId,
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
    @Param('buildingId') buildingId: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: ApprovePaymentDto,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const membershipId = req.user.membershipId;
    const userRoles = req.user.roles || [];
    return this.finanzasService.approvePayment(
      tenantId,
      buildingId,
      paymentId,
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
    @Param('buildingId') buildingId: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: RejectPaymentDto,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const membershipId = req.user.membershipId;
    const userRoles = req.user.roles || [];
    return this.finanzasService.rejectPayment(
      tenantId,
      buildingId,
      paymentId,
      userRoles,
      membershipId,
      dto,
    );
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
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateAllocationDto,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const userRoles = req.user.roles || [];
    return this.finanzasService.createAllocation(
      tenantId,
      buildingId,
      userRoles,
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
    @Param('buildingId') buildingId: string,
    @Param('allocationId') allocationId: string,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const userRoles = req.user.roles || [];
    return this.finanzasService.deleteAllocation(
      tenantId,
      buildingId,
      allocationId,
      userRoles,
    );
  }
}
