import { PrismaClient, Role, TenantType, BillingPlanId } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // ============================================================================
  // BILLING PLANS (A2 scope)
  // ============================================================================
  const plans = await Promise.all([
    prisma.billingPlan.upsert({
      where: { planId: BillingPlanId.FREE },
      update: {},
      create: {
        planId: BillingPlanId.FREE,
        name: "Free",
        description: "Free tier for testing",
        monthlyPrice: 0,
        maxBuildings: 1,
        maxUnits: 10,
        maxUsers: 2,
        maxOccupants: 20,
        canExportReports: false,
        canBulkOperations: false,
        supportLevel: "COMMUNITY",
      },
    }),
    prisma.billingPlan.upsert({
      where: { planId: BillingPlanId.BASIC },
      update: {},
      create: {
        planId: BillingPlanId.BASIC,
        name: "Basic",
        description: "Small buildings",
        monthlyPrice: 9900, // $99.00
        maxBuildings: 3,
        maxUnits: 100,
        maxUsers: 10,
        maxOccupants: 200,
        canExportReports: true,
        canBulkOperations: false,
        supportLevel: "EMAIL",
      },
    }),
    prisma.billingPlan.upsert({
      where: { planId: BillingPlanId.PRO },
      update: {},
      create: {
        planId: BillingPlanId.PRO,
        name: "Pro",
        description: "Growing businesses",
        monthlyPrice: 29900, // $299.00
        maxBuildings: 10,
        maxUnits: 500,
        maxUsers: 50,
        maxOccupants: 1000,
        canExportReports: true,
        canBulkOperations: true,
        supportLevel: "PRIORITY",
      },
    }),
    prisma.billingPlan.upsert({
      where: { planId: BillingPlanId.ENTERPRISE },
      update: {},
      create: {
        planId: BillingPlanId.ENTERPRISE,
        name: "Enterprise",
        description: "Large scale deployments",
        monthlyPrice: 0, // Custom pricing
        maxBuildings: 999,
        maxUnits: 9999,
        maxUsers: 999,
        maxOccupants: 99999,
        canExportReports: true,
        canBulkOperations: true,
        supportLevel: "PRIORITY",
      },
    }),
  ]);
  console.log(`✅ Created ${plans.length} billing plans`);

  // 1) Tenants (idempotente por name)
  const tenantAdmin = await prisma.tenant.upsert({
    where: { name: "Admin Demo" },
    update: { type: TenantType.ADMINISTRADORA },
    create: { name: "Admin Demo", type: TenantType.ADMINISTRADORA },
  });

  const tenantBuilding = await prisma.tenant.upsert({
    where: { name: "Edificio Demo" },
    update: { type: TenantType.EDIFICIO_AUTOGESTION },
    create: { name: "Edificio Demo", type: TenantType.EDIFICIO_AUTOGESTION },
  });

  // 2) Users (idempotente por email)
  // SUPER_ADMIN user (for testing super-admin endpoints)
  const superAdminPassword = await bcrypt.hash("SuperAdmin123!", 10);
  const superAdminUser = await prisma.user.upsert({
    where: { email: "superadmin@demo.com" },
    update: { name: "Super Admin" },
    create: {
      email: "superadmin@demo.com",
      name: "Super Admin",
      passwordHash: superAdminPassword,
    },
  });

  const adminPassword = await bcrypt.hash("Admin123!", 10);
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@demo.com" },
    update: { name: "Admin Demo" },
    create: {
      email: "admin@demo.com",
      name: "Admin Demo",
      passwordHash: adminPassword,
    },
  });

  const operatorPassword = await bcrypt.hash("Operator123!", 10);
  const operatorUser = await prisma.user.upsert({
    where: { email: "operator@demo.com" },
    update: { name: "Operator Demo" },
    create: {
      email: "operator@demo.com",
      name: "Operator Demo",
      passwordHash: operatorPassword,
    },
  });

  const residentPassword = await bcrypt.hash("Resident123!", 10);
  const residentUser = await prisma.user.upsert({
    where: { email: "resident@demo.com" },
    update: { name: "Resident Demo" },
    create: {
      email: "resident@demo.com",
      name: "Resident Demo",
      passwordHash: residentPassword,
    },
  });

  // Helper: upsert membership por unique compuesto (userId, tenantId)
  async function upsertMembershipWithRole(params: {
    tenantId: string;
    userId: string;
    role: Role;
  }) {
    const membership = await prisma.membership.upsert({
      where: {
        userId_tenantId: {
          userId: params.userId,
          tenantId: params.tenantId,
        },
      },
      update: {},
      create: { tenantId: params.tenantId, userId: params.userId },
    });

    await prisma.membershipRole.upsert({
      where: {
        membershipId_role: {
          membershipId: membership.id,
          role: params.role,
        },
      },
      update: {},
      create: { membershipId: membership.id, role: params.role },
    });

    return membership;
  }

  // 3) Memberships & Roles
  // SUPER_ADMIN has a "virtual" membership (no tenant scoping)
  // In JWT payload, isSuperAdmin flag is set via auth service
  // For data integrity, create a membership in a dummy tenant if needed
  // For MVP, we just rely on JWT flag + audit logs

  await upsertMembershipWithRole({
    tenantId: tenantAdmin.id,
    userId: adminUser.id,
    role: Role.TENANT_ADMIN,
  });

  await upsertMembershipWithRole({
    tenantId: tenantBuilding.id,
    userId: adminUser.id,
    role: Role.TENANT_ADMIN,
  });

  await upsertMembershipWithRole({
    tenantId: tenantBuilding.id,
    userId: operatorUser.id,
    role: Role.OPERATOR,
  });

  await upsertMembershipWithRole({
    tenantId: tenantBuilding.id,
    userId: residentUser.id,
    role: Role.RESIDENT,
  });

  // 3.5) Create SUPER_ADMIN role for super admin user (in a virtual tenant or directly)
  // For MVP: JWT payload has isSuperAdmin flag, but we need at least one membership
  // Create a membership in admin tenant with SUPER_ADMIN role
  const superAdminMembership = await prisma.membership.upsert({
    where: {
      userId_tenantId: {
        userId: superAdminUser.id,
        tenantId: tenantAdmin.id,
      },
    },
    update: {},
    create: { tenantId: tenantAdmin.id, userId: superAdminUser.id },
  });
  await prisma.membershipRole.upsert({
    where: {
      membershipId_role: {
        membershipId: superAdminMembership.id,
        role: Role.SUPER_ADMIN,
      },
    },
    update: {},
    create: { membershipId: superAdminMembership.id, role: Role.SUPER_ADMIN },
  });

  // ============================================================================
  // SUBSCRIPTIONS (A2 scope)
  // ============================================================================
  const freePlan = plans.find((p) => p.planId === BillingPlanId.FREE)!;
  const proPlan = plans.find((p) => p.planId === BillingPlanId.PRO)!;

  await prisma.subscription.upsert({
    where: { tenantId: tenantAdmin.id },
    update: {},
    create: {
      tenantId: tenantAdmin.id,
      planId: proPlan.id,
      status: "ACTIVE",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },
  });

  await prisma.subscription.upsert({
    where: { tenantId: tenantBuilding.id },
    update: {},
    create: {
      tenantId: tenantBuilding.id,
      planId: freePlan.id,
      status: "TRIAL",
      currentPeriodStart: new Date(),
      trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
    },
  });

  // 4) Buildings (minimal: 1 tenant → 1 building)
  const building = await prisma.building.upsert({
    where: { tenantId_name: { tenantId: tenantBuilding.id, name: "Demo Building" } },
    update: {},
    create: {
      tenantId: tenantBuilding.id,
      name: "Demo Building",
      address: "123 Main St, Apartment Complex",
    },
  });

  // 5) Units (minimal: 1 building → 2 units)
  const unit1 = await prisma.unit.upsert({
    where: { buildingId_code: { buildingId: building.id, code: "101" } },
    update: {},
    create: {
      buildingId: building.id,
      code: "101",
      label: "Apt 101",
      unitType: "APARTMENT",
      occupancyStatus: "OCCUPIED",
    },
  });

  const unit2 = await prisma.unit.upsert({
    where: { buildingId_code: { buildingId: building.id, code: "102" } },
    update: {},
    create: {
      buildingId: building.id,
      code: "102",
      label: "Apt 102",
      unitType: "APARTMENT",
      occupancyStatus: "VACANT",
    },
  });

  // 6) Unit Occupants (1 resident → unit 101 as OWNER + resident user → unit 102 as RESIDENT)
  await prisma.unitOccupant.upsert({
    where: {
      unitId_userId_role: {
        unitId: unit1.id,
        userId: adminUser.id,
        role: "OWNER",
      },
    },
    update: {},
    create: {
      unitId: unit1.id,
      userId: adminUser.id,
      role: "OWNER",
    },
  });

  await prisma.unitOccupant.upsert({
    where: {
      unitId_userId_role: {
        unitId: unit2.id,
        userId: residentUser.id,
        role: "RESIDENT",
      },
    },
    update: {},
    create: {
      unitId: unit2.id,
      userId: residentUser.id,
      role: "RESIDENT",
    },
  });

  console.log("Seed finished.");
  console.log(`\n📊 Seeded data:
  ============================================================================
  SUPER_ADMIN (for testing /api/super-admin endpoints):
  - Email: superadmin@demo.com
  - Password: SuperAdmin123!

  REGULAR USERS:
  - Email: admin@demo.com (TENANT_ADMIN)
  - Email: operator@demo.com (OPERATOR)
  - Email: resident@demo.com (RESIDENT)

  TENANTS:
  - ${tenantAdmin.name} (type: ADMINISTRADORA, plan: PRO, status: ACTIVE)
  - ${tenantBuilding.name} (type: EDIFICIO_AUTOGESTION, plan: FREE, status: TRIAL)

  BUILDINGS & UNITS:
  - Building: ${building.name} (${building.address})
  - Units: ${unit1.label} (${unit1.code}, OCCUPIED), ${unit2.label} (${unit2.code}, VACANT)
  - Occupants: ${adminUser.name} as OWNER in ${unit1.label}, ${residentUser.name} as RESIDENT in ${unit2.label}
  ============================================================================
  `);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
