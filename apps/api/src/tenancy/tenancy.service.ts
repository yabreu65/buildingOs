import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenancyService {
  constructor(private prisma: PrismaService) {}

  async getMembershipsForUser(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: {
        roles: true,
      },
    });

    return memberships.map((m) => ({
      tenantId: m.tenantId,
      roles: m.roles.map((r) => r.role),
    }));
  }
}
