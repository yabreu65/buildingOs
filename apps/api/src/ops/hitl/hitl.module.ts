import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AssistantModule } from '../../assistant/assistant.module';
import { HitlController } from './hitl.controller';
import { HitlRepository } from './hitl.repository';
import { HitlService } from './hitl.service';

@Module({
  imports: [PrismaModule, AssistantModule],
  controllers: [HitlController],
  providers: [HitlRepository, HitlService],
  exports: [HitlRepository, HitlService],
})
export class HitlModule {}
