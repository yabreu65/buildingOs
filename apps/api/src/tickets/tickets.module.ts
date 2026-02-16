import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { TicketsValidators } from './tickets.validators';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TicketsController],
  providers: [TicketsService, TicketsValidators],
  exports: [TicketsService, TicketsValidators],
})
export class TicketsModule {}
