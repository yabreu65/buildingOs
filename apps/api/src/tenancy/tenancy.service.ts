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
      roles: m.roles
        .filter((r) => r.scopeType === 'TENANT')
        .map((r) => r.role),
      scopedRoles: m.roles.map((r) => ({
        id: r.id,
        role: r.role,
        scopeType: r.scopeType,
        scopeBuildingId: r.scopeBuildingId,
        scopeUnitId: r.scopeUnitId,
      })),
    }));
  }
}
