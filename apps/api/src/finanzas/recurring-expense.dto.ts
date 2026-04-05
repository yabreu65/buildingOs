export interface CreateRecurringExpenseDto {
  categoryId: string;
  amount: number; // in cents
  currency: string; // ISO: ARS, VES, USD
  concept: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
}

export interface UpdateRecurringExpenseDto {
  isActive?: boolean;
  amount?: number;
  concept?: string;
}

export interface RecurringExpenseDto {
  id: string;
  tenantId: string;
  buildingId: string;
  categoryId: string;
  amount: number;
  currency: string;
  concept: string;
  frequency: string;
  nextRunDate: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
