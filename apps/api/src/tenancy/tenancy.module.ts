import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { TenancyController } from './tenancy.controller';
import { TenancyService } from './tenancy.service';
import { TenancyStatsService } from './tenancy-stats.service';
import { BrandingService } from './branding.service';
import { TenantAccessGuard } from './tenant-access.guard';

/**
 * TenancyModule: módulo de multi-tenancy.
 *
 * Exporta:
 * - TenantAccessGuard: guard reutilizable para validar membership
 * - BrandingService: servicio para gestionar branding del tenant
 *
 * Controllers:
 * - TenancyController: endpoints de ejemplo con validación de tenant
 *
 * Services:
 * - TenancyService: lógica de tenancy (getMembershipsForUser)
 * - TenancyStatsService: estadísticas y métricas del tenant
 * - BrandingService: gestión de logo, colores, nombre comercial
 */
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [TenancyController],
  providers: [TenancyService, TenancyStatsService, BrandingService, TenantAccessGuard],
  exports: [TenantAccessGuard, TenancyService, TenancyStatsService, BrandingService],
})
export class TenancyModule {}
