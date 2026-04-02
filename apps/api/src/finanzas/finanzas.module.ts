import { Module } from '@nestjs/common';
import { FinanzasController } from './finanzas.controller';
import { FinanzasUnitsController } from './finanzas-units.controller';
import { TenantFinanceController } from './tenant-finance.controller';
import { ExpenseCategoriesController } from './expense-categories.controller';
import { ExpensePeriodsController } from './expense-periods.controller';
import { ExpenseLedgerCategoriesController } from './expense-ledger-categories.controller';
import { ExpensesController } from './expenses.controller';
import { IncomesController } from './incomes.controller';
import { LiquidationsController } from './liquidations.controller';
import { FinanzasService } from './finanzas.service';
import { FinanzasValidators } from './finanzas.validators';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpensePeriodsService } from './expense-periods.service';
import { ExpenseLedgerCategoriesService } from './expense-ledger-categories.service';
import { ExpensesService } from './expenses.service';
import { IncomesService } from './incomes.service';
import { LiquidationsService } from './liquidations.service';
import { MovementAllocationService } from './movement-allocation.service';
import { UnitGroupService } from './unit-group.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [
    FinanzasController,
    FinanzasUnitsController,
    TenantFinanceController,
    ExpenseCategoriesController,
    ExpensePeriodsController,
    ExpenseLedgerCategoriesController,
    ExpensesController,
    IncomesController,
    LiquidationsController,
  ],
  providers: [
    FinanzasService,
    FinanzasValidators,
    ExpenseCategoriesService,
    ExpensePeriodsService,
    ExpenseLedgerCategoriesService,
    ExpensesService,
    IncomesService,
    LiquidationsService,
    MovementAllocationService,
    UnitGroupService,
  ],
  exports: [
    FinanzasService,
    FinanzasValidators,
    ExpenseCategoriesService,
    ExpensePeriodsService,
    ExpenseLedgerCategoriesService,
    ExpensesService,
    IncomesService,
    LiquidationsService,
    MovementAllocationService,
    UnitGroupService,
  ],
})
export class FinanzasModule {}
