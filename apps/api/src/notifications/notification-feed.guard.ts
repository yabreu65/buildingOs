import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedRequest } from '../common/types/request.types';

@Injectable()
export class NotificationFeedAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.id;
    if (!userId) {
      throw new ForbiddenException('Usuario no autenticado');
    }

    const tenantId = request.params.tenantId?.trim();
    if (!tenantId) {
      throw new BadRequestException('tenantId es requerido en los parámetros');
    }

    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_tenantId: {
          userId,
          tenantId,
        },
      },
      select: {
        id: true,
        tenantId: true,
        roles: {
          select: {
            id: true,
            role: true,
            scopeType: true,
            scopeBuildingId: true,
            scopeUnitId: true,
          },
        },
      },
    });

    if (!membership || membership.roles.length === 0) {
      throw new ForbiddenException(`No tiene acceso al tenant ${tenantId}`);
    }

    const { id: membershipId, tenantId: resolvedTenantId } = membership;
    request.tenantId = resolvedTenantId;
    request.user.tenantId = resolvedTenantId;
    request.user.membershipId = membershipId;

    return true;
  }
}
