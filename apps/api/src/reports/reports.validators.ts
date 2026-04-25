import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ISO_LOCAL_DATE_REGEX } from './reports.dto';

const REPORT_ALLOWED_ROLES = ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'] as const;
const DEFAULT_TENANT_TIMEZONE = 'America/Argentina/Buenos_Aires';

type ScopeType = 'TENANT' | 'BUILDING' | 'UNIT';

export interface ScopedRoleClaim {
  role: string;
  scopeType: ScopeType | string;
  scopeBuildingId: string | null;
  scopeUnitId: string | null;
}

export interface ReportsMembershipClaim {
  roles?: string[];
  scopedRoles?: ScopedRoleClaim[];
}

/**
 * ReportsValidators: Security and validation helpers for reports endpoints.
 */
@Injectable()
export class ReportsValidators {
  constructor(private prisma: PrismaService) {}

  /**
   * Check if membership includes report read permissions.
   */
  canReadReports(membership: ReportsMembershipClaim | null | undefined): boolean {
    if (!membership) {
      return false;
    }

    const directRoles = membership.roles || [];
    const scopedRoles = (membership.scopedRoles || []).map((role) => role.role);
    const allRoles = new Set([...directRoles, ...scopedRoles]);

    return REPORT_ALLOWED_ROLES.some((role) => allRoles.has(role));
  }

  /**
   * Throw ForbiddenException for reports access.
   */
  throwForbidden(): void {
    throw new ForbiddenException('You do not have permission to access reports');
  }

  /**
   * Resolve all building IDs the membership can access for reports.
   */
  async resolveAccessibleBuildingIds(
    tenantId: string,
    membership: ReportsMembershipClaim | null | undefined,
  ): Promise<string[]> {
    if (!membership) {
      return [];
    }

    const scopedRoles = membership.scopedRoles || [];
    const hasTenantScopedReportRole = scopedRoles.some(
      (role) => role.scopeType === 'TENANT' && this.isAllowedRole(role.role),
    );
    const hasDirectTenantRole = (membership.roles || []).some((role) => this.isAllowedRole(role));

    if (hasTenantScopedReportRole || hasDirectTenantRole) {
      const buildings = await this.prisma.building.findMany({
        where: { tenantId },
        select: { id: true },
      });
      return buildings.map((building) => building.id);
    }

    const buildingScopedIds = scopedRoles
      .filter(
        (role) =>
          role.scopeType === 'BUILDING' &&
          this.isAllowedRole(role.role) &&
          role.scopeBuildingId,
      )
      .map((role) => role.scopeBuildingId as string);

    return [...new Set(buildingScopedIds)];
  }

  /**
   * Validate requested building against accessible scope.
   */
  async resolveBuildingScope(
    tenantId: string,
    requestedBuildingId: string | undefined,
    accessibleBuildingIds: string[],
  ): Promise<string[]> {
    if (accessibleBuildingIds.length === 0) {
      if (!requestedBuildingId) {
        return [];
      }
      this.throwForbidden();
    }

    if (!requestedBuildingId) {
      return accessibleBuildingIds;
    }

    const building = await this.prisma.building.findFirst({
      where: {
        id: requestedBuildingId,
        tenantId,
      },
      select: { id: true },
    });

    if (!building) {
      throw new NotFoundException('Building not found');
    }

    if (!accessibleBuildingIds.includes(requestedBuildingId)) {
      throw new ForbiddenException('Building is out of your access scope');
    }

    return [requestedBuildingId];
  }

  /**
   * Check whether a role can read reports.
   */
  private isAllowedRole(role: string): boolean {
    return REPORT_ALLOWED_ROLES.includes(role as (typeof REPORT_ALLOWED_ROLES)[number]);
  }

  /**
   * Parse date string to Date object.
   */
  parseDate(value?: string): Date | undefined {
    if (!value || value.trim() === '') {
      return undefined;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  /**
   * Parse and validate asOf date in YYYY-MM-DD format.
   */
  parseAsOfDate(value?: string, timezone: string = DEFAULT_TENANT_TIMEZONE): string {
    if (!value || value.trim() === '') {
      return this.getTodayInTimezone(timezone);
    }

    if (!ISO_LOCAL_DATE_REGEX.test(value)) {
      throw new BadRequestException('asOf must be in YYYY-MM-DD format');
    }

    if (!this.isValidLocalDate(value)) {
      throw new BadRequestException('asOf is not a valid calendar date');
    }

    return value;
  }

  /**
   * Validate ISO local date format as a real date (e.g. reject 2026-02-31).
   */
  private isValidLocalDate(value: string): boolean {
    const [yearRaw, monthRaw, dayRaw] = value.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);

    const candidate = new Date(Date.UTC(year, month - 1, day));
    return (
      candidate.getUTCFullYear() === year &&
      candidate.getUTCMonth() === month - 1 &&
      candidate.getUTCDate() === day
    );
  }

  /**
   * Resolve today's date for a timezone as YYYY-MM-DD.
   */
  private getTodayInTimezone(timezone: string): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
}
