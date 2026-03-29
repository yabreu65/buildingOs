import { Module } from '@nestjs/common';
import { CommunicationsController } from './communications.controller';
import { CommunicationsUserController } from './communications-user.controller';
import { CommunicationsInboxController } from './communications-user.controller';
import { CommunicationsService } from './communications.service';
import { CommunicationsValidators } from './communications.validators';
import { PrismaModule } from '../prisma/prisma.module';
import { AppConfigModule } from '../config/config.module';

@Module({
  imports: [PrismaModule, AppConfigModule],
  controllers: [
    CommunicationsController,
    CommunicationsUserController,
    CommunicationsInboxController,
  ],
  providers: [CommunicationsService, CommunicationsValidators],
  exports: [CommunicationsService, CommunicationsValidators],
})
export class CommunicationsModule {}
