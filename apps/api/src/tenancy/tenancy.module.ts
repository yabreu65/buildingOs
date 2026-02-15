import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenancyController } from './tenancy.controller';
import { TenancyService } from './tenancy.service';
import { TenancyStatsService } from './tenancy-stats.service';
import { TenantAccessGuard } from './tenant-access.guard';

/**
 * TenancyModule: módulo de multi-tenancy.
 *
 * Exporta:
 * - TenantAccessGuard: guard reutilizable para validar membership
 * - TenantParam: decorador para especificar nombre de parámetro
 *
 * Controllers:
 * - TenancyController: endpoints de ejemplo con validación de tenant
 *
 * Services:
 * - TenancyService: lógica de tenancy (getMembershipsForUser)
 * - TenancyStatsService: estadísticas y métricas del tenant
 */
@Module({
  imports: [PrismaModule],
  controllers: [TenancyController],
  providers: [TenancyService, TenancyStatsService, TenantAccessGuard],
  exports: [TenantAccessGuard, TenancyService, TenancyStatsService],
})
export class TenancyModule {}
