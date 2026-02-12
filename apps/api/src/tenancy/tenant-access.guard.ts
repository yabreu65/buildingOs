import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { TENANT_PARAM_KEY } from './tenant-param.decorator';

export interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
    name: string;
  };
}

/**
 * TenantAccessGuard: valida que el usuario tenga membership en el tenant solicitado.
 *
 * Uso:
 * @UseGuards(JwtAuthGuard, TenantAccessGuard)
 * @Get('/tenants/:tenantId/...')
 *
 * Parámetro configurable:
 * @TenantParam('tenantId') o usa default 'tenantId'
 *
 * Comportamiento:
 * 1. Lee tenantId desde params (configurable)
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
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    // 1. Obtener userId desde JWT (JwtAuthGuard debe ejecutarse primero)
    const userId = request.user?.id;
    if (!userId) {
      throw new ForbiddenException('Usuario no autenticado');
    }

    // 2. Obtener tenantId desde params (configurable via @TenantParam decorador)
    const tenantParamName = this.reflector.get<string>(TENANT_PARAM_KEY, context.getHandler()) || 'tenantId';
    const tenantId = request.params[tenantParamName] as string | undefined;
    if (!tenantId) {
      throw new BadRequestException(`${tenantParamName} es requerido en los parámetros`);
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
