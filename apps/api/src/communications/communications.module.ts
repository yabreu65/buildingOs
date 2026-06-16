import { Module } from '@nestjs/common';
import { CommunicationsController } from './communications.controller';
import { CommunicationsUserController, ResidentCommunicationsController } from './communications-user.controller';
import { CommunicationsInboxController } from './communications-user.controller';
import { CommunicationsService } from './communications.service';
import { CommunicationsValidators } from './communications.validators';
import { PrismaModule } from '../prisma/prisma.module';
import { AppConfigModule } from '../config/config.module';
import { EmailDeliveryModule } from './email/email-delivery.module';
import { EmailBounceController } from './email/webhooks/email-bounce.controller';
import { DeliveryTrackingService } from './email/delivery-tracking.service';

@Module({
  imports: [PrismaModule, AppConfigModule, EmailDeliveryModule.register({
    mailProvider: 'none',
    mailFrom: 'BuildingOS <no-reply@buildingos.local>',
  })],
  controllers: [
    CommunicationsController,
    CommunicationsUserController,
    CommunicationsInboxController,
    ResidentCommunicationsController,
    EmailBounceController,
  ],
  providers: [CommunicationsService, CommunicationsValidators, DeliveryTrackingService],
  exports: [CommunicationsService, CommunicationsValidators, DeliveryTrackingService],
})
export class CommunicationsModule {}
