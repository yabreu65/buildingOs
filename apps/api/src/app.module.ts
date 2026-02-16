import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { TenantsModule } from './tenants/tenants.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { BuildingsModule } from './buildings/buildings.module';
import { UnitsModule } from './units/units.module';
import { OccupantsModule } from './occupants/occupants.module';
import { SuperAdminModule } from './super-admin/super-admin.module';
import { TicketsModule } from './tickets/tickets.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    PrismaModule,
    HealthModule,
    TenantsModule,
    TenancyModule,
    BuildingsModule,
    UnitsModule,
    OccupantsModule,
    SuperAdminModule,
    TicketsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
