import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { resolveTenantId } from '../common/tenant-context/tenant-context.resolver';
import { AuthenticatedRequest } from '../common/types/request.types';
import { AssistantMessagesService } from './assistant-messages.service';

@Controller('assistant/messages')
@UseGuards(JwtAuthGuard)
export class AssistantMessagesController {
  constructor(private readonly assistantMessagesService: AssistantMessagesService) {}

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('Authenticated user required');
    }

    const tenantId = resolveTenantId(req, {
      allowHeaderFallback: true,
      allowSingleMembershipFallback: true,
      requireMembership: true,
    });

    const parsedLimit =
      limit && limit.trim().length > 0
        ? Number(limit)
        : undefined;

    return this.assistantMessagesService.listForUser({
      tenantId,
      userId,
      cursor,
      limit: parsedLimit,
    });
  }
}
