import { Module } from '@nestjs/common';
import { FinanzasController } from './finanzas.controller';
import { FinanzasUnitsController } from './finanzas-units.controller';
import { FinanzasService } from './finanzas.service';
import { FinanzasValidators } from './finanzas.validators';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FinanzasController, FinanzasUnitsController],
  providers: [FinanzasService, FinanzasValidators],
  exports: [FinanzasService, FinanzasValidators],
})
export class FinanzasModule {}
