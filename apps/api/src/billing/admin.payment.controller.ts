import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { PaymentService } from './payment.service';
import { PaymentVerificationStatus } from '@prisma/client';

export interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
  };
}

@Controller('admin/payments')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class AdminPaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  /**
   * GET /admin/payments
   * List pending payments for admin dashboard
   */
  @Get()
  async listPendingPayments(
    @Query('status') status?: PaymentVerificationStatus,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.paymentService.listPendingPayments({
      status: status || PaymentVerificationStatus.PENDING,
      tenantId,
    });
  }

  /**
   * GET /admin/payments/:id
   * Get payment verification details
   */
  @Get(':id')
  async getPayment(@Param('id') paymentId: string) {
    return this.paymentService.getPaymentVerification(paymentId);
  }

  /**
   * POST /admin/payments/:id/approve
   * Approve a payment verification (transitions subscription to ACTIVE)
   */
  @Post(':id/approve')
  async approvePayment(
    @Param('id') paymentId: string,
    @Request() req: RequestWithUser,
  ) {
    return this.paymentService.approvePayment(paymentId, {
      approvedByUserId: req.user.id,
    });
  }

  /**
   * POST /admin/payments/:id/reject
   * Reject a payment verification
   */
  @Post(':id/reject')
  async rejectPayment(
    @Param('id') paymentId: string,
    @Body() dto: { reason: string },
    @Request() req: RequestWithUser,
  ) {
    return this.paymentService.rejectPayment(paymentId, {
      approvedByUserId: req.user.id,
      reason: dto.reason,
    });
  }
}
