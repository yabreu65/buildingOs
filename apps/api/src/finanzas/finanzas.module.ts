import { Module } from '@nestjs/common';
import { FinanzasController } from './finanzas.controller';
import { FinanzasService } from './finanzas.service';
import { FinanzasValidators } from './finanzas.validators';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FinanzasController],
  providers: [FinanzasService, FinanzasValidators],
  exports: [FinanzasService, FinanzasValidators],
})
export class FinanzasModule {}
