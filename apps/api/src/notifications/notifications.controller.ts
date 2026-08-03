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
import { Type } from 'class-transformer';
import { NotificationType } from '@prisma/client';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { NotificationFeedAccessGuard } from './notification-feed.guard';
import { AuthenticatedRequest } from '../common/types/request.types';

class ListNotificationsQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  isRead?: 'true' | 'false';

  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
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

class NotificationParamDto {
  @IsString()
  id!: string;
}

/**
 * Notifications Controller
 *
 * ENDPOINTS:
 * GET    /tenants/:tenantId/notifications                   → List tenant notifications
 * GET    /tenants/:tenantId/notifications/unread-count      → Get unread count
 * PATCH  /tenants/:tenantId/notifications/:id/read          → Mark notification as read
 * PATCH  /tenants/:tenantId/notifications/read-all          → Mark all as read
 * DELETE /tenants/:tenantId/notifications/:id               → Delete notification
 */

@Controller('tenants/:tenantId/notifications')
@UseGuards(JwtAuthGuard, NotificationFeedAccessGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Get tenantId from guard-populated request param
   * @throws BadRequestException when tenant context is missing
   */
  private getTenantId(req: AuthenticatedRequest): string {
    if (!req.tenantId) {
      throw new BadRequestException('Tenant ID required');
    }
    return req.tenantId;
  }

  /**
   * List user's notifications with pagination
   * GET /tenants/:tenantId/notifications?isRead=false&type=TICKET_STATUS_CHANGED&skip=0&take=50
   */
  @Get()
  async listNotifications(
    @Request() req: AuthenticatedRequest,
    @Query() query: ListNotificationsQueryDto,
  ) {
    const user = req.user;
    const tenantId = this.getTenantId(req);
    const skipNum = Math.max(0, query.skip ?? 0);
    const takeNum = Math.min(100, query.take ?? 50);

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
   * GET /tenants/:tenantId/notifications/unread-count
   */
  @Get('unread-count')
  async getUnreadCount(@Request() req: AuthenticatedRequest): Promise<UnreadCountResponseDto> {
    const user = req.user;
    const tenantId = this.getTenantId(req);

    const count = await this.notificationsService.getUnreadCount(tenantId, user.id);
    return { unreadCount: count };
  }

  /**
   * Mark single notification as read
   * PATCH /tenants/:tenantId/notifications/:id/read
   */
  @Patch(':id/read')
  async markAsRead(@Param() params: NotificationParamDto, @Request() req: AuthenticatedRequest) {
    const { id } = params;
    const user = req.user;
    const tenantId = this.getTenantId(req);

    return this.notificationsService.markAsRead(id, tenantId, user.id);
  }

  /**
   * Mark all notifications as read
   * PATCH /tenants/:tenantId/notifications/read-all
   */
  @Patch('read-all')
  async markAllAsRead(@Request() req: AuthenticatedRequest): Promise<SuccessResponseDto> {
    const user = req.user;
    const tenantId = this.getTenantId(req);

    await this.notificationsService.markAllAsRead(tenantId, user.id);
    return { success: true };
  }

  /**
   * Delete notification
   * DELETE /tenants/:tenantId/notifications/:id
   */
  @Delete(':id')
  async deleteNotification(
    @Param() params: NotificationParamDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<SuccessResponseDto> {
    const { id } = params;
    const user = req.user;
    const tenantId = this.getTenantId(req);

    await this.notificationsService.deleteNotification(id, tenantId, user.id);
    return { success: true };
  }
}
