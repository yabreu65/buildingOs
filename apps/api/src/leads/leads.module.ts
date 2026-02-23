import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { PublicLeadsController } from './public-leads.controller';
import { AdminLeadsController } from './admin-leads.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { AuditModule } from '../audit/audit.module';
import { AppConfigModule } from '../config/config.module';

@Module({
  imports: [PrismaModule, EmailModule, AuditModule, AppConfigModule],
  controllers: [PublicLeadsController, AdminLeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
