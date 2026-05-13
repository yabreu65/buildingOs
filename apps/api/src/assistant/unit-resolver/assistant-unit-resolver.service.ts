import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatResponse } from '../ai.types';
import { UnitCodeNormalizer } from '../unit-code-normalizer';

export interface UnitToken {
  unitCode: string;
  buildingAlias?: string;
  buildingName?: string;
  unitCodeCandidates?: string[];
  unitCodeRaw?: string;
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
    const unitCodeCandidates = token.unitCodeCandidates?.length
      ? token.unitCodeCandidates
      : this.buildUnitCodeCandidates(token.unitCode);

    // Sin edificio explícito: resolver por código visible dentro del tenant.
    // No exigir al usuario una clave compuesta interna.
    if (!token.buildingAlias && !token.buildingName) {
      return this.resolveWithoutExplicitBuilding(tenantId, token, unitCodeCandidates);
    }

    // Paso 1: Resolver el edificio
    const buildingResult = await this.resolveBuilding(tenantId, token);
    if ('errorResponse' in buildingResult) {
      return buildingResult;
    }
    const building = buildingResult.building;

    // Paso 2: Buscar unidad en el edificio resuelto
    let unit = await this.prisma.unit.findFirst({
      where: {
        tenantId,
        buildingId: building.id,
        code: token.unitCode,
      },
      select: { id: true, code: true, label: true, unitType: true },
    });

    if (!unit && unitCodeCandidates.length > 1) {
      unit = await this.prisma.unit.findFirst({
        where: {
          tenantId,
          buildingId: building.id,
          code: { in: unitCodeCandidates.filter((candidate) => candidate !== token.unitCode) },
        },
        select: { id: true, code: true, label: true, unitType: true },
      });
    }

    if (!unit) {
      return await this.handleUnitNotFound(tenantId, building, token, unitCodeCandidates);
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

  private async resolveWithoutExplicitBuilding(
    tenantId: string,
    token: UnitToken,
    unitCodeCandidates: string[],
  ): Promise<
    | { resolved: ResolvedUnit; errorResponse: null }
    | { resolved: null; errorResponse: ChatResponse }
  > {
    const requestedUnitCode = this.getRequestedUnitCode(token);

    const exactMatches = await this.prisma.unit.findMany({
      where: { tenantId, code: token.unitCode },
      select: {
        id: true,
        code: true,
        label: true,
        unitType: true,
        buildingId: true,
        building: { select: { id: true, name: true, alias: true } },
      },
      take: 10,
    });

    if (exactMatches.length === 1) {
      return this.buildResolvedFromMatch(tenantId, exactMatches[0]!);
    }

    if (exactMatches.length > 1) {
      return this.buildAmbiguousUnitResponse(requestedUnitCode, exactMatches);
    }

    const secondaryCandidates = unitCodeCandidates.filter((candidate) => candidate !== token.unitCode);
    if (secondaryCandidates.length > 0) {
      const candidateMatches = await this.prisma.unit.findMany({
        where: { tenantId, code: { in: secondaryCandidates } },
        select: {
          id: true,
          code: true,
          label: true,
          unitType: true,
          buildingId: true,
          building: { select: { id: true, name: true, alias: true } },
        },
        take: 10,
      });

      if (candidateMatches.length === 1) {
        return this.buildResolvedFromMatch(tenantId, candidateMatches[0]!);
      }

      if (candidateMatches.length > 1) {
        return this.buildAmbiguousUnitResponse(requestedUnitCode, candidateMatches);
      }
    }

    const similarUnits = await this.findSimilarUnitsAcrossTenant(tenantId, unitCodeCandidates);
    if (similarUnits.length > 0) {
      const options = similarUnits
        .map((unit) => `- ${unit.building.name} — Unidad ${unit.code}`)
        .join('\n');
      return {
        resolved: null,
        errorResponse: {
          answer: `No encontré la unidad ${requestedUnitCode}. Encontré unidades similares:\n${options}\n¿Te referís a alguna de estas?`,
          suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
        },
      };
    }

    return {
      resolved: null,
      errorResponse: {
        answer: `No encontré la unidad ${requestedUnitCode} en tus edificios. ¿Querés revisar el código?`,
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
      },
    };
  }

  private async handleUnitNotFound(
    tenantId: string,
    building: { id: string; name: string; alias: string },
    token: UnitToken,
    unitCodeCandidates: string[],
  ): Promise<{ resolved: null; errorResponse: ChatResponse }> {
    const requestedUnitCode = this.getRequestedUnitCode(token);
    const displayCode = requestedUnitCode;

    // Buscar en otros edificios del mismo tenant
    const otherUnit = await this.prisma.unit.findFirst({
      where: {
        tenantId,
        code: unitCodeCandidates.length === 1 ? unitCodeCandidates[0] : { in: unitCodeCandidates },
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
          answer: `No encontré la unidad ${displayCode} en ${building.name}, pero existe ${otherUnit.building.alias}-${otherUnit.code} en ${otherUnit.building.name}. ¿Te referís a esa?`,
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
        code: unitCodeCandidates.length === 1 ? unitCodeCandidates[0] : { in: unitCodeCandidates },
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
          answer: `No encontré la unidad ${displayCode} como apartamento, pero existe como estacionamiento en ${parkingUnit.building.name} (${parkingUnit.building.alias}-${parkingUnit.code}).`,
          suggestedActions: [
            { type: 'VIEW_REPORTS', payload: { buildingId: parkingUnit.buildingId } },
          ],
        },
      };
    }

    const similarNeedles = unitCodeCandidates
      .map((candidate) => candidate.replace(/[^A-Z0-9]/gi, ''))
      .filter((candidate) => candidate.length >= 2);
    const similarUnits = similarNeedles.length
      ? await this.prisma.unit.findMany({
          where: {
            tenantId,
            buildingId: building.id,
            OR: similarNeedles.map((needle) => ({
              code: {
                contains: needle,
                mode: 'insensitive',
              },
            })),
          },
          select: { code: true },
          take: 3,
        })
      : [];

    if (similarUnits.length > 0) {
      const similarList = similarUnits.map((u) => u.code).join(', ');
      return {
        resolved: null,
        errorResponse: {
          answer: `No encontré la unidad ${displayCode}. Encontré unidades similares: ${similarList}. ¿Te referís a alguna?`,
          suggestedActions: [{ type: 'VIEW_REPORTS', payload: { buildingId: building.id } }],
        },
      };
    }

    return {
      resolved: null,
      errorResponse: {
        answer: `No encontré la unidad ${displayCode}. ¿Querés revisar el código?`,
        suggestedActions: [
          { type: 'VIEW_REPORTS', payload: { buildingId: building.id } },
        ],
      },
    };
  }

  private buildUnitCodeCandidates(rawCode: string): string[] {
    return UnitCodeNormalizer.normalize(rawCode).candidates;
  }

  private getRequestedUnitCode(token: UnitToken): string {
    return (token.unitCodeRaw?.trim() || token.unitCode).toUpperCase();
  }

  private async buildResolvedFromMatch(
    tenantId: string,
    match: {
      id: string;
      code: string;
      label: string | null;
      unitType: string;
      buildingId: string;
      building: { id: string; name: string; alias: string | null };
    },
  ): Promise<{ resolved: ResolvedUnit; errorResponse: null }> {
    let associatedApartment: { id: string; code: string; displayCode: string } | null = null;

    if (match.unitType === 'ESTACIONAMIENTO') {
      const association = await this.prisma.unitAssociation.findFirst({
        where: { tenantId, buildingId: match.buildingId, parkingId: match.id },
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
          displayCode: `${match.building.alias ?? match.building.name}-${association.apartment.code}`,
        };
      }
    }

    const buildingAlias = match.building.alias ?? match.building.name;
    return {
      resolved: {
        building: {
          id: match.building.id,
          name: match.building.name,
          alias: buildingAlias,
        },
        unit: {
          id: match.id,
          code: match.code,
          label: match.label,
          unitType: match.unitType,
        },
        displayCode: `${buildingAlias}-${match.code}`,
        associatedApartment,
      },
      errorResponse: null,
    };
  }

  private buildAmbiguousUnitResponse(
    requestedUnitCode: string,
    matches: Array<{
      id: string;
      code: string;
      buildingId: string;
      building: { name: string; alias: string | null };
    }>,
  ): { resolved: null; errorResponse: ChatResponse } {
    const options = matches
      .slice(0, 5)
      .map((match, index) => `${index + 1}. ${match.building.name} — Unidad ${match.code}`)
      .join('\n');

    return {
      resolved: null,
      errorResponse: {
        answer: `Encontré más de una unidad ${requestedUnitCode}:\n${options}\n¿De cuál querés consultar la deuda?`,
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
      },
    };
  }

  private async findSimilarUnitsAcrossTenant(
    tenantId: string,
    unitCodeCandidates: string[],
  ): Promise<Array<{ code: string; building: { name: string } }>> {
    const similarNeedles = unitCodeCandidates
      .map((candidate) => candidate.replace(/[^A-Z0-9]/gi, ''))
      .filter((candidate) => candidate.length >= 2);

    if (similarNeedles.length === 0) {
      return [];
    }

    return this.prisma.unit.findMany({
      where: {
        tenantId,
        OR: similarNeedles.map((needle) => ({
          code: {
            contains: needle,
            mode: 'insensitive',
          },
        })),
      },
      select: {
        code: true,
        building: { select: { name: true } },
      },
      take: 3,
    });
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

    // Sin edificio explícito este método no debería ser invocado.
    return {
      resolved: null,
      errorResponse: {
        answer: 'Necesito que me indiques el edificio para continuar.',
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
      },
    };
  }
}
