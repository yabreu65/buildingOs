import {
  Injectable,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { SignupDto, TenantTypeEnum } from './dto/signup.dto';
import { AuditAction } from '@prisma/client';
import * as bcrypt from 'bcrypt';

interface UserWithMemberships {
  id: string;
  email: string;
  name: string;
  memberships: Array<{
    tenantId: string;
    roles: Array<{ role: string }>;
  }>;
}

export interface AuthResponse {
  accessToken: string;
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

    // Check if email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('El email ya está registrado');
    }

    // Validate passwords
    if (!password || password.length < 8) {
      throw new BadRequestException(
        'La contraseña debe tener al menos 8 caracteres',
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const finalTenantName = tenantName || 'Mi Condominio';
    const finalTenantType = tenantType || TenantTypeEnum.EDIFICIO_AUTOGESTION;

    // Transaction: create user, tenant, membership, and role
    const result = await this.prisma.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email,
          name,
          passwordHash: hashedPassword,
        },
      });

      // Create tenant
      const tenant = await tx.tenant.create({
        data: {
          name: finalTenantName,
          type: finalTenantType,
        },
      });

      // Create membership
      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
        },
      });

      // Create TENANT_OWNER role
      await tx.membershipRole.create({
        data: {
          membershipId: membership.id,
          role: 'TENANT_OWNER',
        },
      });

      return { user, tenant, membership };
    });

    // Get memberships and return auth response
    const memberships = await this.tenancyService.getMembershipsForUser(
      result.user.id,
    );

    return {
      accessToken: this.jwtService.sign({
        email: result.user.email,
        sub: result.user.id,
        isSuperAdmin: false,
      }),
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
      },
      memberships,
    };
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

  async login(user: UserWithMemberships): Promise<AuthResponse> {
    const isSuperAdmin = user.memberships.some((m) =>
      m.roles.some((r) => r.role === 'SUPER_ADMIN'),
    );

    const payload = {
      email: user.email,
      sub: user.id,
      isSuperAdmin,
    };

    const memberships = await this.tenancyService.getMembershipsForUser(user.id);

    // Audit: AUTH_LOGIN
    void this.auditService.createLog({
      actorUserId: user.id,
      action: AuditAction.AUTH_LOGIN,
      entityType: 'User',
      entityId: user.id,
      metadata: {
        email: user.email,
        isSuperAdmin,
      },
    });

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      memberships,
    };
  }

  /**
   * Log failed login attempt
   * Called from controller when validateUser returns null
   */
  async logFailedLogin(email: string): Promise<void> {
    void this.auditService.createLog({
      action: AuditAction.AUTH_FAILED_LOGIN,
      entityType: 'User',
      entityId: email, // Use email as entityId for failed logins
      metadata: {
        email,
      },
    });
  }
}
