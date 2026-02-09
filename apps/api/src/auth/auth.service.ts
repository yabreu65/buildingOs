import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private tenancyService: TenancyService,
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
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
      return result;
    }
    return null;
  }

  async login(user: any) {
    const isSuperAdmin = user.memberships.some((m) =>
      m.roles.some((r) => r.role === 'SUPER_ADMIN'),
    );

    const payload = {
      email: user.email,
      sub: user.id,
      isSuperAdmin,
    };

    const memberships = await this.tenancyService.getMembershipsForUser(user.id);

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
}
