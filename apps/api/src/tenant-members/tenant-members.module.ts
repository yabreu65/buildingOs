import { Module } from '@nestjs/common';
import { TenantMembersService } from './tenant-members.service';
import { TenantMembersController } from './tenant-members.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../email/email.module';
import { AppConfigModule } from '../config/config.module';

@Module({
  imports: [PrismaModule, AuditModule, EmailModule, AppConfigModule],
  controllers: [TenantMembersController],
  providers: [TenantMembersService],
  exports: [TenantMembersService],
})
export class TenantMembersModule {}
