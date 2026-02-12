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
}

interface ValidatedUser {
  id: string;
  email: string;
  name: string;
  memberships: Array<{
    tenantId: string;
    roles: string[];
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
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    const memberships = await this.tenancyService.getMembershipsForUser(user.id);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      memberships,
    };
  }
}
