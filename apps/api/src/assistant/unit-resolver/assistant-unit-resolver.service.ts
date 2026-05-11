import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatResponse } from '../ai.types';

export interface UnitToken {
  unitCode: string;
  buildingAlias?: string;
  buildingName?: string;
}

export interface ResolvedUnit {
  building: { id: string; name: string; alias: string };
  unit: { id: string; code: string; label: string | null; unitType: string };
  displayCode: string;
  associatedApartment?: { id: string; code: string; displayCode: string } | null;
}

@Injectable()
export class AssistantUnitResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resuelve building + unit a partir de un token parseado.
   *
   * Reglas:
   * 1. Si hay buildingAlias → buscar por alias exacto
   * 2. Si hay buildingName → buscar por nombre (fuzzy)
   * 3. Si no hay building → contar edificios del tenant
   *    - 1 edificio → usar automáticamente
   *    - 2+ edificios → error de ambigüedad
   * 4. Una vez resuelto el edificio → buscar Unit por code
   * 5. Si no encuentra → buscar en otros edificios y sugerir
   */
  async resolve(
    tenantId: string,
    token: UnitToken,
  ): Promise<
    | { resolved: ResolvedUnit; errorResponse: null }
    | { resolved: null; errorResponse: ChatResponse }
  > {
    // Paso 1: Resolver el edificio
    const buildingResult = await this.resolveBuilding(tenantId, token);
    if ('errorResponse' in buildingResult) {
      return buildingResult;
    }
    const building = buildingResult.building;

    // Paso 2: Buscar unidad en el edificio resuelto
    const unit = await this.prisma.unit.findFirst({
      where: {
        tenantId,
        buildingId: building.id,
        code: token.unitCode,
      },
      select: { id: true, code: true, label: true, unitType: true },
    });

    if (!unit) {
      return await this.handleUnitNotFound(tenantId, building, token);
    }

    // Paso 3: Si es estacionamiento, buscar apartamento asociado
    let associatedApartment = null;
    if (unit.unitType === 'ESTACIONAMIENTO') {
      const association = await this.prisma.unitAssociation.findFirst({
        where: { tenantId, buildingId: building.id, parkingId: unit.id },
        include: {
          apartment: {
            select: { id: true, code: true },
          },
        },
      });

      if (association?.apartment) {
        associatedApartment = {
          id: association.apartment.id,
          code: association.apartment.code,
          displayCode: `${building.alias}-${association.apartment.code}`,
        };
      }
    }

    return {
      resolved: {
        building,
        unit,
        displayCode: `${building.alias}-${unit.code}`,
        associatedApartment,
      },
      errorResponse: null,
    };
  }

  private async handleUnitNotFound(
    tenantId: string,
    building: { id: string; name: string; alias: string },
    token: UnitToken,
  ): Promise<{ resolved: null; errorResponse: ChatResponse }> {
    const displayCode = `${building.alias}-${token.unitCode}`;

    // Buscar en otros edificios del mismo tenant
    const otherUnit = await this.prisma.unit.findFirst({
      where: {
        tenantId,
        code: token.unitCode,
        buildingId: { not: building.id },
      },
      include: {
        building: { select: { alias: true, name: true } },
      },
    });

    if (otherUnit) {
      return {
        resolved: null,
        errorResponse: {
          answer: `No encontré ${displayCode} en ${building.name}, pero existe ${otherUnit.building.alias}-${token.unitCode} en ${otherUnit.building.name}. ¿Te referís a ese?`,
          suggestedActions: [
            { type: 'VIEW_REPORTS', payload: { buildingId: otherUnit.buildingId } },
          ],
        },
      };
    }

    // Buscar si existe como estacionamiento
    const parkingUnit = await this.prisma.unit.findFirst({
      where: {
        tenantId,
        code: token.unitCode,
        unitType: 'ESTACIONAMIENTO',
      },
      include: {
        building: { select: { alias: true, name: true } },
      },
    });

    if (parkingUnit) {
      return {
        resolved: null,
        errorResponse: {
          answer: `No encontré ${displayCode} como apartamento, pero existe como estacionamiento en ${parkingUnit.building.name} (${parkingUnit.building.alias}-${token.unitCode}).`,
          suggestedActions: [
            { type: 'VIEW_REPORTS', payload: { buildingId: parkingUnit.buildingId } },
          ],
        },
      };
    }

    return {
      resolved: null,
      errorResponse: {
        answer: `No encontré el departamento ${displayCode}.`,
        suggestedActions: [
          { type: 'VIEW_REPORTS', payload: { buildingId: building.id } },
        ],
      },
    };
  }

  private async resolveBuilding(
    tenantId: string,
    token: UnitToken,
  ): Promise<
    | { building: { id: string; name: string; alias: string } }
    | { resolved: null; errorResponse: ChatResponse }
  > {
    // Caso 1: Alias explícito
    if (token.buildingAlias) {
      const found = await this.prisma.building.findFirst({
        where: { tenantId, alias: token.buildingAlias, deletedAt: null },
        select: { id: true, name: true, alias: true },
      });

      if (!found || !found.alias) {
        return {
          resolved: null,
          errorResponse: {
            answer: `No encontré el edificio ${token.buildingAlias} en este tenant.`,
            suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
          },
        };
      }

      return { building: found as { id: string; name: string; alias: string } };
    }

    // Caso 2: Nombre de edificio explícito
    if (token.buildingName) {
      const found = await this.prisma.building.findFirst({
        where: {
          tenantId,
          deletedAt: null,
          name: { contains: token.buildingName, mode: 'insensitive' },
        },
        select: { id: true, name: true, alias: true },
      });

      if (!found || !found.alias) {
        return {
          resolved: null,
          errorResponse: {
            answer: `No encontré el edificio "${token.buildingName}" en este tenant.`,
            suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
          },
        };
      }

      return { building: found as { id: string; name: string; alias: string } };
    }

    // Caso 3: Sin edificio especificado → inferir
    const buildings = await this.prisma.building.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, alias: true },
    });

    if (buildings.length === 0) {
      return {
        resolved: null,
        errorResponse: {
          answer: 'Este tenant todavía no tiene edificios configurados.',
          suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
        },
      };
    }

    if (buildings.length === 1) {
      const b = buildings[0]!;
      if (!b.alias) {
        return {
          resolved: null,
          errorResponse: {
            answer: 'El edificio no tiene alias configurado.',
            suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
          },
        };
      }
      return { building: b as { id: string; name: string; alias: string } };
    }

    // 2+ edificios → ambigüedad
    const aliases = buildings
      .map((b) => b.alias)
      .filter((a): a is string => a !== null);
    return {
      resolved: null,
      errorResponse: {
        answer: `Necesito que me indiques el edificio. Por ejemplo: ${aliases.map((a) => `${a}-${token.unitCode}`).join(' o ')}.`,
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
      },
    };
  }
}
