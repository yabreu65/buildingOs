import { IsNumber, Min, Max, IsNotEmpty } from 'class-validator';

/**
 * Update AI Budget DTO
 *
 * PATCH /super-admin/tenants/:tenantId/ai/budget
 * - monthlyBudgetCents: Monthly AI budget in cents (0-500000 = $0-$5000)
 */
export class UpdateAiBudgetDto {
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  @Max(500000)
  monthlyBudgetCents!: number;
}
