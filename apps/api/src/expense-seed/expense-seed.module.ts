import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { ExpenseLedgerSeedService } from './expense-seed.service';
import { ExpenseSeedController } from './expense-seed.controller';

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [ExpenseLedgerSeedService],
  controllers: [ExpenseSeedController],
  exports: [ExpenseLedgerSeedService],
})
export class ExpenseSeedModule {}
