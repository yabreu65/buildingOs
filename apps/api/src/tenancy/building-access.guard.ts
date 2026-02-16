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

    // 6. Guardar tenantId en el request para uso en el controller
    request.tenantId = building.tenantId;

    return true;
  }
}
