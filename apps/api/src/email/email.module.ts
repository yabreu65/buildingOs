/**
 * Email Module
 * Provides email sending capabilities via SMTP, SendGrid, Mailgun
 */

import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { EmailService } from './email.service';

@Module({
  imports: [AppConfigModule, PrismaModule, AuditModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
