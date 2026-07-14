import {
  Injectable,
  ConflictException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { SignupDto, TenantTypeEnum } from './dto/signup.dto';
import { AuditAction, AuthSession } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

interface UserWithMemberships {
  id: string;
  email: string;
  name: string;
  memberships: Array<{
    tenantId: string;
    roles: Array<{ role: string }>;
  }>;
}

interface TenantMembershipForLogin {
  tenantId: string;
  roles: string[];
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
  memberships: Array<{
    tenantId: string;
    roles: string[];
  }>;
}

interface IssueAuthResult extends AuthResponse {
  session: AuthSession;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private tenancyService: TenancyService,
    private auditService: AuditService,
  ) {}

  async signup(dto: SignupDto): Promise<AuthResponse> {
    const { email, name, password, tenantName, tenantType } = dto;

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('El email ya está registrado');
    }

    if (!password || password.length < 8) {
      throw new BadRequestException(
        'La contraseña debe tener al menos 8 caracteres',
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const finalTenantName = tenantName || 'Mi Condominio';
    const finalTenantType = tenantType || TenantTypeEnum.EDIFICIO_AUTOGESTION;

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name,
          passwordHash: hashedPassword,
        },
      });

      const tenant = await tx.tenant.create({
        data: {
          name: finalTenantName,
          type: finalTenantType,
        },
      });

      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
        },
      });

      await tx.membershipRole.create({
        data: {
          tenantId: tenant.id,
          membershipId: membership.id,
          role: 'TENANT_OWNER',
        },
      });

      return { user, tenant, membership };
    });

    const memberships = await this.tenancyService.getMembershipsForUser(
      result.user.id,
    );

    void this.auditService.createLog({
      tenantId: result.membership.tenantId,
      actorUserId: result.user.id,
      action: AuditAction.USER_CREATE,
      entityType: 'User',
      entityId: result.user.id,
      metadata: {
        email: result.user.email,
        name: result.user.name,
        tenantName: finalTenantName,
      },
    });

    return this.createAuthResponse({
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
      },
      memberships,
      isSuperAdmin: false,
      sessionContext: {
        userAgent: null,
        ipAddress: null,
      },
    });
  }

  async validateUser(email: string, pass: string): Promise<UserWithMemberships | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          include: {
            roles: true,
          },
        },
      },
    });

    if (user && (await bcrypt.compare(pass, user.passwordHash))) {
      const { passwordHash, ...result } = user;
      return result as UserWithMemberships;
    }
    return null;
  }

  async login(
    user: UserWithMemberships,
    selectedTenantId?: string | null,
  ): Promise<AuthResponse> {
    const memberships = (await this.tenancyService.getMembershipsForUser(user.id)) as TenantMembershipForLogin[];
    const isSuperAdmin = memberships.some((m) =>
      m.roles.includes('SUPER_ADMIN'),
    );
    const loginAuditTenantId = this.resolveLoginAuditTenantId(
      memberships,
      isSuperAdmin,
      selectedTenantId,
    );
    const auditMetadata = {
      email: user.email,
      isSuperAdmin,
      membershipCount: memberships.length,
      tenantIds: memberships.map((membership) => membership.tenantId),
      selectedTenantId: loginAuditTenantId,
    };

    if (loginAuditTenantId) {
      void this.auditService.createLog({
        tenantId: loginAuditTenantId,
        actorUserId: user.id,
        action: AuditAction.AUTH_LOGIN,
        entityType: 'User',
        entityId: user.id,
        metadata: auditMetadata,
      });
    } else {
      void this.auditService.createGlobalLog({
        actorUserId: user.id,
        action: AuditAction.AUTH_LOGIN,
        entityType: 'User',
        entityId: user.id,
        metadata: auditMetadata,
      });
    }

    return this.createAuthResponse({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      memberships,
      isSuperAdmin,
      sessionContext: {
        userAgent: null,
        ipAddress: null,
      },
    });
  }

  async refreshSession(refreshToken: string): Promise<AuthResponse> {
    const tokenHash = this.hashToken(refreshToken);
    const session = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash: tokenHash },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Sesión expirada. Vuelve a iniciar sesión.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    const memberships = await this.tenancyService.getMembershipsForUser(user.id);
    const isSuperAdmin = memberships.some((m) =>
      m.roles.includes('SUPER_ADMIN'),
    );

    const nextRefreshToken = crypto.randomBytes(32).toString('hex');

    return this.createAuthResponse({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      memberships,
      isSuperAdmin,
      sessionContext: {
        userAgent: null,
        ipAddress: null,
      },
      existingSessionId: session.id,
      existingRefreshToken: nextRefreshToken,
    });
  }

  async logoutSession(sessionId: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: {
        id: sessionId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  async logoutAllSessions(userId: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  async getSessionByAccessToken(sessionId: string): Promise<AuthSession | null> {
    return this.prisma.authSession.findFirst({
      where: {
        id: sessionId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  }

  async logFailedLogin(email: string): Promise<void> {
    void this.auditService.createLog({
      action: AuditAction.AUTH_FAILED_LOGIN,
      entityType: 'User',
      entityId: email,
      metadata: {
        email,
      },
    });
  }

  async createAuthResponse(params: {
    user: {
      id: string;
      email: string;
      name: string;
    };
    memberships: Array<{
      tenantId: string;
      roles: string[];
    }>;
    isSuperAdmin: boolean;
    sessionContext: {
      userAgent: string | null;
      ipAddress: string | null;
    };
    existingSessionId?: string;
    existingRefreshToken?: string;
  }): Promise<IssueAuthResult> {
    const roles = params.memberships[0]?.roles ?? [];
    const sessionId = params.existingSessionId ?? this.createSessionId();
    const refreshToken =
      params.existingRefreshToken ?? crypto.randomBytes(32).toString('hex');
    const refreshTokenHash = this.hashToken(refreshToken);

    const session = params.existingSessionId
      ? await this.prisma.authSession.update({
          where: { id: sessionId },
          data: {
            refreshTokenHash,
            expiresAt: this.getSessionExpiresAt(),
            lastUsedAt: new Date(),
            userAgent: params.sessionContext.userAgent,
            ipAddress: params.sessionContext.ipAddress,
            revokedAt: null,
          },
        })
      : await this.prisma.authSession.create({
          data: {
            id: sessionId,
            userId: params.user.id,
            refreshTokenHash,
            expiresAt: this.getSessionExpiresAt(),
            userAgent: params.sessionContext.userAgent,
            ipAddress: params.sessionContext.ipAddress,
          },
        });

    const accessToken = this.jwtService.sign({
      email: params.user.email,
      sub: params.user.id,
      isSuperAdmin: params.isSuperAdmin,
      roles,
      sid: session.id,
    });

    return {
      accessToken,
      refreshToken,
      sessionId: session.id,
      user: params.user,
      memberships: params.memberships,
      session,
    };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private resolveLoginAuditTenantId(
    memberships: TenantMembershipForLogin[],
    isSuperAdmin: boolean,
    selectedTenantId?: string | null,
  ): string | null {
    if (selectedTenantId != null) {
      const matchingMembership = memberships.find(
        (membership) => membership.tenantId === selectedTenantId,
      );

      return matchingMembership?.tenantId ?? null;
    }

    if (isSuperAdmin) {
      return null;
    }

    if (memberships.length === 1) {
      return memberships[0]?.tenantId ?? null;
    }

    return null;
  }

  private getSessionExpiresAt(): Date {
    return new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  }

  private createSessionId(): string {
    return crypto.randomBytes(16).toString('hex');
  }
}
