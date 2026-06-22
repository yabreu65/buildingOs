import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/**
 * DemoTenantGuard: blocks write operations on demo tenants.
 *
 * Registered as APP_GUARD so it runs on every request.
 * - GET, HEAD, OPTIONS → allowed (read-only)
 * - POST, PUT, PATCH, DELETE → blocked if tenant.isDemo === true
 *
 * Tenant ID resolution order:
 * 1. request.params.tenantId (from URL)
 * 2. request.tenantId (set by TenantAccessGuard or BuildingAccessGuard)
 *
 * If no tenantId is found, the guard passes — the route has no tenant context.
 */
@Injectable()
export class DemoTenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { tenantId?: string }>();
    const method = request.method.toUpperCase();

    // Read-only methods are always allowed
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return true;
    }

    if (this.isAllowedDemoAssistantMutation(request)) {
      return true;
    }

    // Resolve tenantId from params or from previously-set request.tenantId
    const tenantId =
      (request.params as Record<string, string | undefined>)?.tenantId ??
      request.tenantId;

    // No tenant context on this route — not our concern
    if (!tenantId) {
      return true;
    }

    // Check if this is a demo tenant
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { isDemo: true },
    });

    if (tenant?.isDemo === true) {
      throw new ForbiddenException(
        'This demo environment is read-only. Create, update, and delete operations are disabled.',
      );
    }

    return true;
  }

  private isAllowedDemoAssistantMutation(request: Request): boolean {
    if (request.method.toUpperCase() !== 'POST') {
      return false;
    }

    const path = (request.originalUrl || request.url || '').split('?')[0] || '';

    return /^\/tenants\/[^/]+\/assistant\/(chat(?:\/v2)?|ticket-replies|action-events)$/.test(path);
  }
}
