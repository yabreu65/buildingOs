import { IsNotEmpty } from 'class-validator';

export class DismissOnboardingDto {
  @IsNotEmpty()
  tenantId: string;
}

export class RestoreOnboardingDto {
  @IsNotEmpty()
  tenantId: string;
}

export class TenantStepsResponseDto {
  tenantId: string;
  steps: {
    id: string;
    label: string;
    description: string;
    status: 'DONE' | 'TODO';
    category: 'tenant' | 'building';
  }[];
  isDismissed: boolean;
  completionPercentage: number;
}

export class BuildingStepsResponseDto {
  buildingId: string;
  tenantId: string;
  buildingName: string;
  steps: {
    id: string;
    label: string;
    description: string;
    status: 'DONE' | 'TODO';
    category: 'building';
  }[];
  completionPercentage: number;
}
