/**
 * Email Module
 * Provides email sending capabilities via SMTP, SendGrid, Mailgun
 */

import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { EmailService } from './email.service';

@Module({
  imports: [AppConfigModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
