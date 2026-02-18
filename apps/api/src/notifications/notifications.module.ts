import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../email/email.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

/**
 * NotificationsModule: Global module for in-app + email notifications
 *
 * Available to all other modules without explicit imports.
 * Provides fire-and-forget notification delivery (never blocks calling operation).
 */
@Global()
@Module({
  imports: [PrismaModule, AuditModule, EmailModule],
  providers: [NotificationsService],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
