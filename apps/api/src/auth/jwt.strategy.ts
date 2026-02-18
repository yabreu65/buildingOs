import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';

interface JwtPayload {
  email: string;
  sub: string;
  isSuperAdmin: boolean;
  isImpersonating?: boolean;
  impersonatedTenantId?: string;
  actorSuperAdminUserId?: string;
}

interface ScopedRole {
  id: string;
  role: string;
  scopeType: string;
  scopeBuildingId: string | null;
  scopeUnitId: string | null;
}

interface ValidatedUser {
  id: string;
  email: string;
  name: string;
  isSuperAdmin?: boolean;
  isImpersonating?: boolean;
  impersonatedTenantId?: string;
  actorSuperAdminUserId?: string;
  memberships: Array<{
    tenantId: string;
    roles: string[];
    scopedRoles?: ScopedRole[];
  }>;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private tenancyService: TenancyService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<ValidatedUser> {
    // IMPERSONATION: Special handling for isImpersonating tokens
    if (payload.isImpersonating && payload.impersonatedTenantId) {
      // Validate impersonated tenant still exists
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: payload.impersonatedTenantId },
        select: { id: true, name: true },
      });
      if (!tenant) {
        throw new UnauthorizedException(
          'Impersonated tenant no longer exists',
        );
      }

      // Validate actor user still exists
      const actor = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, name: true },
      });
      if (!actor) {
        throw new UnauthorizedException('Actor user not found');
      }

      // Return user with SYNTHETIC tenant membership (TENANT_ADMIN access)
      return {
        id: actor.id,
        email: actor.email,
        name: `[Soporte] ${actor.name}`,
        isSuperAdmin: false, // KEY: not SA in this context
        isImpersonating: true,
        impersonatedTenantId: payload.impersonatedTenantId,
        actorSuperAdminUserId: payload.actorSuperAdminUserId,
        memberships: [
          {
            tenantId: payload.impersonatedTenantId,
            roles: ['TENANT_ADMIN'], // Full tenant admin access
          },
        ],
      };
    }

    // NORMAL FLOW: existing code (non-impersonation tokens)
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    const memberships = await this.tenancyService.getMembershipsForUser(user.id);

    // Derive isSuperAdmin from memberships (can also trust JWT payload as hint)
    const isSuperAdmin =
      payload.isSuperAdmin ||
      memberships.some((m) => m.roles.includes('SUPER_ADMIN'));

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isSuperAdmin,
      memberships,
    };
  }
}
