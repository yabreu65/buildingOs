import { Module, Global } from '@nestjs/common';
import { CommunicationsModule } from '../../communications/communications.module';
import { FinanzasModule } from '../../finanzas/finanzas.module';
import { TicketsModule } from '../../tickets/tickets.module';
import { CronJobsService } from './cron-jobs.service';

@Global()
@Module({
  imports: [CommunicationsModule, FinanzasModule, TicketsModule],
  providers: [CronJobsService],
  exports: [CronJobsService],
})
export class CronJobsModule {}
