import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
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
}

/**
 * TenantAccessGuard: valida que el usuario tenga membership en el tenant solicitado.
 *
 * Uso:
 * @UseGuards(JwtAuthGuard, TenantAccessGuard)
 * @Get('/tenants/:tenantId/...')
 * async findAll(@TenantParam() tenantId: string) { ... }
 *
 * Comportamiento:
 * 1. Lee tenantId desde URL params
 * 2. Lee userId desde req.user (poblado por JwtAuthGuard)
 * 3. Busca Membership en Prisma
 * 4. Si existe => permite
 * 5. Si no existe => ForbiddenException (403)
 */
@Injectable()
export class TenantAccessGuard implements CanActivate {
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

    // 2. Obtener tenantId desde params (default: 'tenantId')
    const tenantId = request.params.tenantId as string | undefined;
    if (!tenantId) {
      throw new BadRequestException(`tenantId es requerido en los parámetros`);
    }

    // 3. Validar membership en Prisma
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_tenantId: {
          userId,
          tenantId,
        },
      },
    });

    // 4. Si no existe membership => Forbidden
    if (!membership) {
      throw new ForbiddenException(
        `No tiene acceso al tenant ${tenantId}`,
      );
    }

    // 5. Permite ejecución
    return true;
  }
}
