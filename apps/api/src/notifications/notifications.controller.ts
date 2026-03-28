import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { AuthenticatedRequest } from '../common/types/request.types';

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
   * List user's notifications with pagination
   * GET /me/notifications?isRead=false&type=TICKET_STATUS_CHANGED&skip=0&take=50
   */
  @Get()
  async listNotifications(
    @Request() req: AuthenticatedRequest,
    @Query('isRead') isRead?: string,
    @Query('type') type?: string,
    @Query('skip') skip: string = '0',
    @Query('take') take: string = '50',
  ) {
    const user = req.user;
    const tenantId = user.memberships?.[0]?.tenantId;
    const skipNum = Math.max(0, parseInt(skip, 10));
    const takeNum = Math.min(100, parseInt(take, 10) || 50);

    // Parse isRead filter
    let isReadFilter: boolean | undefined;
    if (isRead === 'true') isReadFilter = true;
    if (isRead === 'false') isReadFilter = false;

    return this.notificationsService.queryNotifications(
      tenantId,
      user.id,
      {
        isRead: isReadFilter,
        type: type as NotificationType | undefined,
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
  async getUnreadCount(@Request() req: AuthenticatedRequest) {
    const user = req.user;
    const tenantId = user.memberships?.[0]?.tenantId;

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
    const tenantId = user.memberships?.[0]?.tenantId;

    return this.notificationsService.markAsRead(id, tenantId, user.id);
  }

  /**
   * Mark all notifications as read
   * PATCH /me/notifications/read-all
   */
  @Patch('read-all')
  async markAllAsRead(@Request() req: AuthenticatedRequest) {
    const user = req.user;
    const tenantId = user.memberships?.[0]?.tenantId;

    return this.notificationsService.markAllAsRead(tenantId, user.id);
  }

  /**
   * Delete notification
   * DELETE /me/notifications/:id
   */
  @Delete(':id')
  async deleteNotification(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const user = req.user;
    const tenantId = user.memberships?.[0]?.tenantId;

    await this.notificationsService.deleteNotification(id, tenantId, user.id);
    return { success: true };
  }
}
