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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';

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
  constructor(private notificationsService: NotificationsService) {}

  /**
   * List user's notifications with pagination
   * GET /me/notifications?isRead=false&type=TICKET_STATUS_CHANGED&skip=0&take=50
   */
  @Get()
  async listNotifications(
    @Request() req: any,
    @Query('isRead') isRead?: string,
    @Query('type') type?: string,
    @Query('skip') skip: string = '0',
    @Query('take') take: string = '50',
  ) {
    const user = req.user;
    const tenantId = user.activeTenantId; // Get active tenant from user session
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
        type: type as any,
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
  async getUnreadCount(@Request() req: any) {
    const user = req.user;
    const tenantId = user.activeTenantId;

    const count = await this.notificationsService.getUnreadCount(tenantId, user.id);
    return { unreadCount: count };
  }

  /**
   * Mark single notification as read
   * PATCH /me/notifications/:id/read
   */
  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @Request() req: any) {
    const user = req.user;
    const tenantId = user.activeTenantId;

    return this.notificationsService.markAsRead(id, tenantId, user.id);
  }

  /**
   * Mark all notifications as read
   * PATCH /me/notifications/read-all
   */
  @Patch('read-all')
  async markAllAsRead(@Request() req: any) {
    const user = req.user;
    const tenantId = user.activeTenantId;

    return this.notificationsService.markAllAsRead(tenantId, user.id);
  }

  /**
   * Delete notification
   * DELETE /me/notifications/:id
   */
  @Delete(':id')
  async deleteNotification(@Param('id') id: string, @Request() req: any) {
    const user = req.user;
    const tenantId = user.activeTenantId;

    await this.notificationsService.deleteNotification(id, tenantId, user.id);
    return { success: true };
  }
}
