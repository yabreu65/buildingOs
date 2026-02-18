import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface TenantOnboardingStep {
  id: string;
  label: string;
  description: string;
  status: 'DONE' | 'TODO';
  category: 'tenant' | 'building';
}

export interface BuildingOnboardingStep {
  id: string;
  label: string;
  description: string;
  status: 'DONE' | 'TODO';
  category: 'building';
}

@Injectable()
export class OnboardingService {
  constructor(private prisma: PrismaService) {}

  /**
   * Calculate tenant-level onboarding steps (T1-T6):
   * - T1: Create First Building
   * - T2: Create First Unit
   * - T3: Add First User
   * - T4: Set Subscription Plan
   * - T5: Create First Ticket
   * - T6: Create First Communication
   *
   * @param tenantId - Tenant ID
   * @returns Array of tenant onboarding steps with completion status
   */
  async calculateTenantSteps(tenantId: string): Promise<TenantOnboardingStep[]> {
    // T1: Check if tenant has at least 1 building
    const buildingCount = await this.prisma.building.count({
      where: { tenantId },
    });

    // T2: Check if tenant has at least 1 unit
    const unitCount = await this.prisma.unit.count({
      where: { building: { tenantId } },
    });

    // T3: Check if tenant has at least 2 users (besides owner)
    const memberCount = await this.prisma.membership.count({
      where: { tenantId },
    });

    // T4: Check if tenant has a subscription (besides trial)
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });
    const hasNonTrialPlan =
      subscription && subscription.status !== 'TRIAL' && subscription.plan.planId !== 'FREE';

    // T5: Check if tenant has at least 1 ticket
    const ticketCount = await this.prisma.ticket.count({
      where: { tenantId },
    });

    // T6: Check if tenant has at least 1 communication
    const communicationCount = await this.prisma.communication.count({
      where: { tenantId },
    });

    return [
      {
        id: 'T1',
        label: 'Create First Building',
        description: 'Register your first building or property',
        status: buildingCount > 0 ? 'DONE' : 'TODO',
        category: 'tenant',
      },
      {
        id: 'T2',
        label: 'Add Units',
        description: 'Create at least one unit (apartment, office, etc.)',
        status: unitCount > 0 ? 'DONE' : 'TODO',
        category: 'tenant',
      },
      {
        id: 'T3',
        label: 'Invite Team Members',
        description: 'Add staff or administrators to your team',
        status: memberCount > 1 ? 'DONE' : 'TODO',
        category: 'tenant',
      },
      {
        id: 'T4',
        label: 'Upgrade Your Plan',
        description: 'Select a billing plan suitable for your needs',
        status: hasNonTrialPlan ? 'DONE' : 'TODO',
        category: 'tenant',
      },
      {
        id: 'T5',
        label: 'Create First Ticket',
        description: 'File a maintenance request or complaint',
        status: ticketCount > 0 ? 'DONE' : 'TODO',
        category: 'tenant',
      },
      {
        id: 'T6',
        label: 'Send Communication',
        description: 'Share an announcement with your residents',
        status: communicationCount > 0 ? 'DONE' : 'TODO',
        category: 'tenant',
      },
    ];
  }

  /**
   * Calculate building-level onboarding steps (B1-B4):
   * - B1: Add Building Occupants
   * - B2: Upload Building Documents
   * - B3: Set Building Charges
   * - B4: Assign Vendors/Service Providers
   *
   * @param buildingId - Building ID
   * @returns Array of building onboarding steps with completion status
   */
  async calculateBuildingSteps(buildingId: string): Promise<BuildingOnboardingStep[]> {
    // Verify building exists
    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
    });

    if (!building) {
      throw new Error(`Building ${buildingId} not found`);
    }

    // B1: Check if building has at least 1 occupant assigned
    const occupantCount = await this.prisma.unitOccupant.count({
      where: { unit: { buildingId } },
    });

    // B2: Check if building has at least 1 document
    const documentCount = await this.prisma.document.count({
      where: { buildingId },
    });

    // B3: Check if building has at least 1 charge
    const chargeCount = await this.prisma.charge.count({
      where: { buildingId },
    });

    // B4: Check if building has at least 1 vendor assigned
    const vendorCount = await this.prisma.vendorAssignment.count({
      where: { buildingId },
    });

    return [
      {
        id: 'B1',
        label: 'Assign Unit Residents',
        description: 'Add occupants and owners to your units',
        status: occupantCount > 0 ? 'DONE' : 'TODO',
        category: 'building',
      },
      {
        id: 'B2',
        label: 'Upload Documents',
        description: 'Add rules, contracts, or minutes (optional)',
        status: documentCount > 0 ? 'DONE' : 'TODO',
        category: 'building',
      },
      {
        id: 'B3',
        label: 'Create Charges',
        description: 'Set up common expenses or special charges',
        status: chargeCount > 0 ? 'DONE' : 'TODO',
        category: 'building',
      },
      {
        id: 'B4',
        label: 'Assign Service Providers',
        description: 'Add vendors for maintenance and repairs',
        status: vendorCount > 0 ? 'DONE' : 'TODO',
        category: 'building',
      },
    ];
  }

  /**
   * Dismiss the onboarding checklist for a tenant.
   * Once dismissed, it will not be shown in the UI.
   *
   * @param tenantId - Tenant ID to dismiss onboarding for
   */
  async dismissOnboarding(tenantId: string): Promise<void> {
    await this.prisma.onboardingState.upsert({
      where: { tenantId },
      update: { dismissedAt: new Date() },
      create: { tenantId, dismissedAt: new Date() },
    });
  }

  /**
   * Restore onboarding checklist visibility (undo dismiss).
   * Used if user wants to see the checklist again.
   *
   * @param tenantId - Tenant ID to restore onboarding for
   */
  async restoreOnboarding(tenantId: string): Promise<void> {
    await this.prisma.onboardingState.upsert({
      where: { tenantId },
      update: { dismissedAt: null },
      create: { tenantId, dismissedAt: null },
    });
  }

  /**
   * Check if onboarding is dismissed for a tenant.
   *
   * @param tenantId - Tenant ID
   * @returns true if dismissed, false otherwise
   */
  async isOnboardingDismissed(tenantId: string): Promise<boolean> {
    const state = await this.prisma.onboardingState.findUnique({
      where: { tenantId },
    });
    return state?.dismissedAt !== null && state?.dismissedAt !== undefined;
  }
}
