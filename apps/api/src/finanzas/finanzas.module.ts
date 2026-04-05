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
import { UnitGroupController } from './unit-group.controller';
import { MovementAllocationController } from './movement-allocation.controller';
import { LiquidationEngineController } from './liquidation-engine.controller';
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
import { LiquidationEngineService } from './liquidation-engine.service';
import { PrismaModule } from '../prisma/prisma.module';

import { VendorPreferenceController } from './vendor-preference.controller';
import { VendorPreferenceService } from './vendor-preference.service';
import { ExpenseReportsController } from './expense-reports.controller';
import { ExpenseReportsService } from './expense-reports.service';
import { ExpenseImportService } from './expense-import.service';
import { RecurringExpenseController } from './recurring-expense.controller';
import { RecurringExpenseService } from './recurring-expense.service';

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
    UnitGroupController,
    MovementAllocationController,
    LiquidationEngineController,
    VendorPreferenceController,
    ExpenseReportsController,
    RecurringExpenseController,
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
    LiquidationEngineService,
    VendorPreferenceService,
    ExpenseReportsService,
    ExpenseImportService,
    RecurringExpenseService,
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
    LiquidationEngineService,
  ],
})
export class FinanzasModule {}
