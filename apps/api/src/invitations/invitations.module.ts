import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { AuthModule } from '../auth/auth.module';
import { InvitationsService } from './invitations.service';
import { InvitationsPublicController } from './invitations.controller';
import { InvitationsAdminController } from './invitations.controller';

@Module({
  imports: [ScheduleModule, PrismaModule, TenancyModule, AuditModule, BillingModule, AuthModule],
  controllers: [InvitationsPublicController, InvitationsAdminController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
