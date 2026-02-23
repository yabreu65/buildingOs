import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { PublicLeadsController } from './public-leads.controller';
import { AdminLeadsController } from './admin-leads.controller';
import { EmailModule } from '../email/email.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [EmailModule, AuditModule],
  controllers: [PublicLeadsController, AdminLeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
