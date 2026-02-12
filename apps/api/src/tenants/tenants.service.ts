import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface TenantSummary {
  id: string;
  name: string;
  type: 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
}

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Obtiene todos los tenants donde el usuario tiene membership.
   * Ordenados por nombre ascendente.
   *
   * @param userId ID del usuario
   * @returns Array de TenantSummary
   */
  async listTenantsForUser(userId: string): Promise<TenantSummary[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: {
        tenant: true,
      },
      orderBy: {
        tenant: {
          name: 'asc',
        },
      },
    });

    return memberships.map((m) => ({
      id: m.tenant.id,
      name: m.tenant.name,
      type: m.tenant.type,
    }));
  }
}
