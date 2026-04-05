import { Module, Global } from '@nestjs/common';
import { CommunicationsModule } from '../../communications/communications.module';
import { CronJobsService } from './cron-jobs.service';

@Global()
@Module({
  imports: [CommunicationsModule],
  providers: [CronJobsService],
  exports: [CronJobsService],
})
export class CronJobsModule {}
