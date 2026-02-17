import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { SuperAdminController } from './super-admin.controller';
import { SuperAdminService } from './super-admin.service';

@Module({
  imports: [
    PrismaModule,
    TenancyModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '60m' }, // Short expiry for impersonation tokens
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [SuperAdminController],
  providers: [SuperAdminService],
})
export class SuperAdminModule {}
