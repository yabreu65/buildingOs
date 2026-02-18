import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizeService } from '../rbac/authorize.service';

export interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
    name: string;
    memberships: Array<{
      tenantId: string;
      roles: string[];
    }>;
  };
  tenantId?: string; // Populated by this guard
}

/**
 * BuildingAccessGuard: valida que el usuario tenga acceso al building
 *
 * Validaciones:
 * 1. Building debe existir
 * 2. Building debe pertenecer a uno de los tenants del usuario
 * 3. Usuario debe tener membership activa en ese tenant
 *
 * Uso:
 * @UseGuards(JwtAuthGuard, BuildingAccessGuard)
 * @Get('/buildings/:buildingId/...')
 *
 * Resultado:
 * - Si es válido: req.tenantId se asigna para uso en el controller
 * - Si falla: 403 Forbidden o 404 Not Found
 */
@Injectable()
export class BuildingAccessGuard implements CanActivate {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AuthorizeService)
    private readonly authorize: AuthorizeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    // 1. Obtener userId desde JWT (JwtAuthGuard debe ejecutarse primero)
    const userId = request.user?.id;
    if (!userId) {
      throw new ForbiddenException('Usuario no autenticado');
    }

    // 2. Obtener buildingId desde params
    const buildingId = request.params.buildingId as string | undefined;
    if (!buildingId) {
      throw new BadRequestException('buildingId es requerido en los parámetros');
    }

    // 3. Buscar el building en la BD
    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
      select: { id: true, tenantId: true },
    });

    // 4. Si el building no existe, responder 404 (no filtrar existencia)
    if (!building) {
      throw new NotFoundException(
        `Building not found or does not belong to this tenant`,
      );
    }

    // 5. Verificar que el usuario tiene membership en el tenant del building
    const userTenantIds = request.user.memberships.map((m) => m.tenantId);
    if (!userTenantIds.includes(building.tenantId)) {
      throw new ForbiddenException(
        `No tiene acceso al building en este tenant`,
      );
    }

    // 6. Check scoped access: user must have TENANT-scoped access OR BUILDING-scoped access to this building
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_tenantId: { userId, tenantId: building.tenantId },
      },
      include: {
        roles: true,
      },
    });

    if (!membership) {
      throw new ForbiddenException(
        `No tiene membresía activa en este tenant`,
      );
    }

    // Check if user has TENANT-scoped roles (can access all buildings)
    const hasTenantScopedRole = membership.roles.some(r => r.scopeType === 'TENANT');

    // Check if user has BUILDING-scoped role for this specific building
    const hasBuildingScopedRole = membership.roles.some(
      r => r.scopeType === 'BUILDING' && r.scopeBuildingId === buildingId,
    );

    if (!hasTenantScopedRole && !hasBuildingScopedRole) {
      // User neither has tenant-scoped access nor building-specific access
      throw new ForbiddenException(
        `No tiene acceso a este building`,
      );
    }

    // 7. Guardar tenantId y buildingId en el request para uso en el controller
    request.tenantId = building.tenantId;

    return true;
  }
}
