/**
 * Email Module
 * Provides email sending capabilities via SMTP, SendGrid, Mailgun
 */

import { Module } from '@nestjs/common';
import { EmailService } from './email.service';

@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
