import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';
import { UnsubscribePushDto } from './dto/unsubscribe-push.dto';
import { assertValidPushSubscriptionEndpoint } from './push-endpoint.validator';
import type { AuthenticatedRequest } from '../common/types/request.types';

@Controller('push')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /push/subscribe
   * Subscribe user to web push notifications
   *
   * Body:
   * - endpoint: push subscription endpoint URL
   * - p256dh: client public key
   * - auth: auth secret
   *
   * Creates or updates push subscription for user in tenant
   */
  @Post('subscribe')
  async subscribe(
    @Body() dto: SubscribePushDto,
    @Request() req: AuthenticatedRequest,
  ) {
    assertValidPushSubscriptionEndpoint(dto.endpoint);

    const userMemberships = req.user?.memberships || [];
    if (userMemberships.length === 0) {
      throw new BadRequestException('User does not have a tenant membership');
    }

    const tenantId = userMemberships[0]!.tenantId;
    const userId = req.user.id;

    // Upsert push subscription
    await this.prisma.pushSubscription.upsert({
      where: {
        tenantId_userId_endpoint: {
          tenantId,
          userId,
          endpoint: dto.endpoint,
        },
      },
      create: {
        tenantId,
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.p256dh,
        auth: dto.auth,
      },
      update: {
        p256dh: dto.p256dh,
        auth: dto.auth,
        revokedAt: null, // Reactivate if was revoked
      },
    });

    return { success: true };
  }

  /**
   * POST /push/unsubscribe
   * Unsubscribe user from web push notifications
   *
   * Body:
   * - endpoint: push subscription endpoint URL to revoke
   */
  @Post('unsubscribe')
  async unsubscribe(
    @Body() dto: UnsubscribePushDto,
    @Request() req: AuthenticatedRequest,
  ) {
    assertValidPushSubscriptionEndpoint(dto.endpoint);

    const userMemberships = req.user?.memberships || [];
    if (userMemberships.length === 0) {
      throw new BadRequestException('User does not have a tenant membership');
    }

    const tenantId = userMemberships[0]!.tenantId;
    const userId = req.user.id;

    // Revoke push subscription
    await this.prisma.pushSubscription.updateMany({
      where: {
        tenantId,
        userId,
        endpoint: dto.endpoint,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return { success: true };
  }
}
