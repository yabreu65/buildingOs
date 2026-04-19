import { Module, Global } from '@nestjs/common';
import { CommunicationsModule } from '../../communications/communications.module';
import { FinanzasModule } from '../../finanzas/finanzas.module';
import { TicketsModule } from '../../tickets/tickets.module';
import { AppConfigModule } from '../../config/config.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { CronJobsService } from './cron-jobs.service';
import { CronJobsTriggerController } from './cron-jobs-trigger.controller';

@Global()
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    CommunicationsModule,
    FinanzasModule,
    TicketsModule,
  ],
  controllers: [CronJobsTriggerController],
  providers: [CronJobsService],
  exports: [CronJobsService],
})
export class CronJobsModule {}

// Note: RecurringExpenseService is already available via FinanzasModule
