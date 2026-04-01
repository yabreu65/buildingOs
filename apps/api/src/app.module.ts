import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from './config/config.module';
import { SecurityModule } from './security/security.module';
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
// HealthModule removed - consolidated into ObservabilityModule
import { TenantsModule } from './tenants/tenants.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { BuildingsModule } from './buildings/buildings.module';
import { UnitsModule } from './units/units.module';
import { OccupantsModule } from './occupants/occupants.module';
import { SuperAdminModule } from './super-admin/super-admin.module';
import { TicketsModule } from './tickets/tickets.module';
import { CommunicationsModule } from './communications/communications.module';
import { DocumentsModule } from './documents/documents.module';
import { VendorsModule } from './vendors/vendors.module';
import { FinanzasModule } from './finanzas/finanzas.module';
import { AuditModule } from './audit/audit.module';
import { ReportsModule } from './reports/reports.module';
import { BillingModule } from './billing/billing.module';
import { InvitationsModule } from './invitations/invitations.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { RbacModule } from './rbac/rbac.module';
import { MembershipsModule } from './memberships/memberships.module';
import { ContextModule } from './context/context.module';
import { InboxModule } from './inbox/inbox.module';
import { SupportTicketsModule } from './support-tickets/support-tickets.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DemoSeedModule } from './demo-seed/demo-seed.module';
import { ExpenseSeedModule } from './expense-seed/expense-seed.module';
import { ObservabilityModule } from './observability/observability.module';
import { AssistantModule } from './assistant/assistant.module';
import { LeadsModule } from './leads/leads.module';
import { TenantMembersModule } from './tenant-members/tenant-members.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { PushController } from './push/push.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AppConfigModule,
    ObservabilityModule,
    SecurityModule,
    EmailModule,
    AuthModule,
    PrismaModule,
    AuditModule,
    RbacModule,
    TenantsModule,
    TenancyModule,
    BuildingsModule,
    UnitsModule,
    OccupantsModule,
    SuperAdminModule,
    TicketsModule,
    CommunicationsModule,
    DocumentsModule,
    VendorsModule,
    FinanzasModule,
    ReportsModule,
    BillingModule,
    InvitationsModule,
    OnboardingModule,
    MembershipsModule,
    ContextModule,
    InboxModule,
    SupportTicketsModule,
    NotificationsModule,
    DemoSeedModule,
    ExpenseSeedModule,
    AssistantModule,
    LeadsModule,
    TenantMembersModule,
    DashboardModule,
  ],
  controllers: [PushController],
  providers: [],
})
export class AppModule {}
