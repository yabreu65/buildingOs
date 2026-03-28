import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { AuthenticatedRequest } from '../common/types/request.types';

class ListNotificationsQueryDto {
  @IsOptional()
  @IsString()
  isRead?: string;

  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}

class UnreadCountResponseDto {
  unreadCount!: number;
}

class SuccessResponseDto {
  success!: boolean;
}

/**
 * Notifications Controller
 *
 * ENDPOINTS:
 * GET    /me/notifications                   → List user's notifications
 * GET    /me/notifications/unread-count      → Get unread count
 * PATCH  /me/notifications/:id/read          → Mark notification as read
 * PATCH  /me/notifications/read-all          → Mark all as read
 * DELETE /me/notifications/:id               → Delete notification
 */

@Controller('me/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Resolve tenantId from authenticated user memberships
   * @throws BadRequestException when tenant context is missing
   */
  private resolveTenantId(req: AuthenticatedRequest): string {
    const tenantId = req.user.memberships?.[0]?.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant context required');
    }
    return tenantId;
  }

  /**
   * List user's notifications with pagination
   * GET /me/notifications?isRead=false&type=TICKET_STATUS_CHANGED&skip=0&take=50
   */
  @Get()
  async listNotifications(
    @Request() req: AuthenticatedRequest,
    @Query() query: ListNotificationsQueryDto,
  ) {
    const user = req.user;
    const tenantId = this.resolveTenantId(req);
    const skipNum = Math.max(0, Number(query.skip ?? 0));
    const takeNum = Math.min(100, Number(query.take ?? 50));

    let isRead: boolean | undefined;
    if (query.isRead === 'true') {
      isRead = true;
    } else if (query.isRead === 'false') {
      isRead = false;
    }

    return this.notificationsService.queryNotifications(
      tenantId,
      user.id,
      {
        isRead,
        type: query.type,
      },
      skipNum,
      takeNum,
    );
  }

  /**
   * Get unread notification count
   * GET /me/notifications/unread-count
   */
  @Get('unread-count')
  async getUnreadCount(@Request() req: AuthenticatedRequest): Promise<UnreadCountResponseDto> {
    const user = req.user;
    const tenantId = this.resolveTenantId(req);

    const count = await this.notificationsService.getUnreadCount(tenantId, user.id);
    return { unreadCount: count };
  }

  /**
   * Mark single notification as read
   * PATCH /me/notifications/:id/read
   */
  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const user = req.user;
    const tenantId = this.resolveTenantId(req);

    return this.notificationsService.markAsRead(id, tenantId, user.id);
  }

  /**
   * Mark all notifications as read
   * PATCH /me/notifications/read-all
   */
  @Patch('read-all')
  async markAllAsRead(@Request() req: AuthenticatedRequest): Promise<SuccessResponseDto> {
    const user = req.user;
    const tenantId = this.resolveTenantId(req);

    await this.notificationsService.markAllAsRead(tenantId, user.id);
    return { success: true };
  }

  /**
   * Delete notification
   * DELETE /me/notifications/:id
   */
  @Delete(':id')
  async deleteNotification(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<SuccessResponseDto> {
    const user = req.user;
    const tenantId = this.resolveTenantId(req);

    await this.notificationsService.deleteNotification(id, tenantId, user.id);
    return { success: true };
  }
}
