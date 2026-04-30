import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AssistantReadOnlyQueryService } from './read-only-query.service';
import {
  AssistantReadOnlyQueryRequest,
  AssistantReadOnlyQueryResponse,
} from './read-only-query.types';

@Controller('assistant')
export class AssistantReadOnlyQueryController {
  /**
   * Traceability:
   * - /Users/yoryiabreu/proyectos/buildingos/docs/architecture/constraints.md
   * - /Users/yoryiabreu/proyectos/yoryi-core-architecture/domains/backend/security/identity-tenant-context.md
   */
  private static readonly READ_ONLY_ALLOWED_ROLES = new Set([
    'SUPER_ADMIN',
    'TENANT_OWNER',
    'TENANT_ADMIN',
    'OPERATOR',
  ]);

  constructor(
    private readonly readOnlyQueryService: AssistantReadOnlyQueryService,
  ) {}

  private requireHeader(name: string, value?: string): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
      throw new BadRequestException(`${name} header is required`);
    }
    return normalized;
  }

  private normalizeOptional(value?: string): string | undefined {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized.length > 0 ? normalized : undefined;
  }

  private resolveAuthoritativeTenantId(
    req: Request & { tenantId?: string },
  ): string {
    const fromContext = this.normalizeOptional(req.tenantId);
    if (fromContext) {
      return fromContext;
    }
    throw new BadRequestException('Tenant context required from middleware/guard');
  }

  private resolveAuthoritativeUserId(
    req: Request & { userId?: string; user?: { id?: string } },
  ): string {
    const fromContext =
      this.normalizeOptional(req.userId) ??
      this.normalizeOptional(req.user?.id);
    if (fromContext) {
      return fromContext;
    }
    throw new BadRequestException('User context required from middleware/guard');
  }

  private resolveAuthoritativeRole(
    req: Request & { role?: string },
  ): string {
    const fromContext = this.normalizeOptional(req.role);
    if (fromContext) {
      return fromContext.toUpperCase();
    }

    throw new BadRequestException('Role context required from middleware/guard');
  }

  private assertHeaderConsistency(
    headers: { tenantIdHeader?: string; userIdHeader?: string; roleHeader?: string },
    authoritative: { tenantId: string; userId: string; role: string },
  ): void {
    const tenantHeader = this.normalizeOptional(headers.tenantIdHeader);
    if (tenantHeader && tenantHeader !== authoritative.tenantId) {
      throw new ForbiddenException('Tenant mismatch between header and authoritative context');
    }

    const userHeader = this.normalizeOptional(headers.userIdHeader);
    if (userHeader && userHeader !== authoritative.userId) {
      throw new ForbiddenException('User mismatch between header and authoritative context');
    }

    const roleHeader = this.normalizeOptional(headers.roleHeader);
    if (roleHeader && roleHeader.toUpperCase() !== authoritative.role) {
      throw new ForbiddenException('Role mismatch between header and authoritative context');
    }
  }

  private assertNoContextOverride(
    request: AssistantReadOnlyQueryRequest,
    authoritative: { tenantId: string; userId: string; role: string },
  ): void {
    const context = request.context;
    if (!context) {
      return;
    }

    const requestTenantId = this.normalizeOptional(context.tenantId);
    if (requestTenantId && requestTenantId !== authoritative.tenantId) {
      throw new ForbiddenException('Tenant mismatch between authoritative context and request context');
    }

    const requestUserId = this.normalizeOptional(context.userId);
    if (requestUserId && requestUserId !== authoritative.userId) {
      throw new ForbiddenException('User mismatch between authoritative context and request context');
    }

    const requestRole = this.normalizeOptional(context.role);
    if (requestRole && requestRole.toUpperCase() !== authoritative.role) {
      throw new ForbiddenException('Role mismatch between authoritative context and request context');
    }
  }

  private assertRoleAllowed(role: string): void {
    if (!AssistantReadOnlyQueryController.READ_ONLY_ALLOWED_ROLES.has(role)) {
      throw new ForbiddenException('Role not allowed for read-only assistant endpoint');
    }
  }

  /**
   * Internal endpoint for deterministic read-only assistant queries.
   * Authoritative tenant/user/role comes from resolved request context (middleware/guard).
   * Request body and headers cannot override tenancy/user/role.
   *
   * Traceability:
   * - /Users/yoryiabreu/proyectos/buildingos/docs/architecture/constraints.md
   * - /Users/yoryiabreu/proyectos/yoryi-core-architecture/domains/backend/security/identity-tenant-context.md
   */
  @Post('read-only-query')
  async query(
    @Body() request: AssistantReadOnlyQueryRequest,
    @Headers('x-api-key') apiKeyHeader?: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Headers('x-user-role') roleHeader?: string,
    @Req() req: Request & {
      tenantId?: string;
      userId?: string;
      role?: string;
      user?: { id?: string };
    },
  ): Promise<AssistantReadOnlyQueryResponse> {
    const apiKey = this.requireHeader('x-api-key', apiKeyHeader);
    const tenantId = this.resolveAuthoritativeTenantId(req);
    const userId = this.resolveAuthoritativeUserId(req);
    const role = this.resolveAuthoritativeRole(req);

    this.assertHeaderConsistency(
      { tenantIdHeader, userIdHeader, roleHeader },
      { tenantId, userId, role },
    );
    this.assertRoleAllowed(role);

    this.assertNoContextOverride(request, { tenantId, userId, role });

    const context = {
      ...(request.context ?? {}),
      tenantId,
      userId,
      role,
      appId: request.context?.appId ?? 'buildingos',
    };
    const normalizedRequest: AssistantReadOnlyQueryRequest = {
      ...request,
      context,
    };

    return this.readOnlyQueryService.execute(normalizedRequest, {
      apiKey,
      tenantId,
      userId,
      role,
      context,
    });
  }
}
