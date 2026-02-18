import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { DemoSeedService } from './demo-seed.service';
import { DemoSeedController } from './demo-seed.controller';

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [DemoSeedService],
  controllers: [DemoSeedController],
  exports: [DemoSeedService],
})
export class DemoSeedModule {}
