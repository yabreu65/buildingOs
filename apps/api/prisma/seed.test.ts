import { PrismaClient, Role, TenantType, BillingPlanId, ChargeStatus, PaymentStatus, PaymentMethod } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { buildSeedExpenseSnapshotItem, ensureSeedPublishedLiquidation } from "./lib/seed-liquidation-workflow";

const prisma = new PrismaClient();

/**
 * Seed determinístico para tests E2E
 * Crea usuarios predecibles con credenciales conocidas para automatización
 */
async function main() {
  console.log("🧪 Seeding test database...");

  // ============================================================================
  // BILLING PLANS (idempotente)
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
        canUseAI: false,
        aiBudgetCents: 0,
        aiCallsMonthlyLimit: 0,
        aiAllowBigModel: false,
        aiConsultationsLimit: 0,
        supportLevel: "COMMUNITY",
      },
    }),
    prisma.billingPlan.upsert({
      where: { planId: BillingPlanId.PRO },
      update: {},
      create: {
        planId: BillingPlanId.PRO,
        name: "Pro",
        description: "Growing businesses",
        monthlyPrice: 29900,
        maxBuildings: 10,
        maxUnits: 500,
        maxUsers: 50,
        maxOccupants: 1000,
        canExportReports: true,
        canBulkOperations: true,
        canUseAI: true,
        aiBudgetCents: 800,
        aiCallsMonthlyLimit: 600,
        aiAllowBigModel: true,
        aiConsultationsLimit: 50,
        supportLevel: "PRIORITY",
      },
    }),
  ]);
  console.log(`✅ Billing plans: ${plans.length}`);

  // ============================================================================
  // TEST USERS (determinísticos)
  // ============================================================================
  const testPassword = await bcrypt.hash("TestPass123!", 10);

  const testUsers = {
    superAdmin: await prisma.user.upsert({
      where: { email: "test-superadmin@buildingos.local" },
      update: { name: "Test Super Admin" },
      create: {
        email: "test-superadmin@buildingos.local",
        name: "Test Super Admin",
        passwordHash: testPassword,
      },
    }),
    tenantAdminA: await prisma.user.upsert({
      where: { email: "test-tenant-admin-a@buildingos.local" },
      update: { name: "Test Admin A" },
      create: {
        email: "test-tenant-admin-a@buildingos.local",
        name: "Test Admin A",
        passwordHash: testPassword,
      },
    }),
    tenantAdminB: await prisma.user.upsert({
      where: { email: "test-tenant-admin-b@buildingos.local" },
      update: { name: "Test Admin B" },
      create: {
        email: "test-tenant-admin-b@buildingos.local",
        name: "Test Admin B",
        passwordHash: testPassword,
      },
    }),
    operator: await prisma.user.upsert({
      where: { email: "test-operator@buildingos.local" },
      update: { name: "Test Operator" },
      create: {
        email: "test-operator@buildingos.local",
        name: "Test Operator",
        passwordHash: testPassword,
      },
    }),
    resident: await prisma.user.upsert({
      where: { email: "test-resident@buildingos.local" },
      update: { name: "Test Resident" },
      create: {
        email: "test-resident@buildingos.local",
        name: "Test Resident",
        passwordHash: testPassword,
      },
    }),
    residentB: await prisma.user.upsert({
      where: { email: "test-resident-b@buildingos.local" },
      update: { name: "Test Resident B" },
      create: {
        email: "test-resident-b@buildingos.local",
        name: "Test Resident B",
        passwordHash: testPassword,
      },
    }),
  };
  console.log(`✅ Test users: ${Object.keys(testUsers).length}`);

  // ============================================================================
  // TENANTS
  // ============================================================================
  const tenantA = await prisma.tenant.upsert({
    where: { name: "Test Tenant A" },
    update: { type: TenantType.ADMINISTRADORA },
    create: {
      name: "Test Tenant A",
      type: TenantType.ADMINISTRADORA,
    },
  });

  const tenantB = await prisma.tenant.upsert({
    where: { name: "Test Tenant B" },
    update: { type: TenantType.EDIFICIO_AUTOGESTION },
    create: {
      name: "Test Tenant B",
      type: TenantType.EDIFICIO_AUTOGESTION,
    },
  });
  console.log(`✅ Tenants: A (${tenantA.id}), B (${tenantB.id})`);

  // ============================================================================
  // SUBSCRIPTIONS
  // ============================================================================
  const proPlan = plans.find((p) => p.planId === BillingPlanId.PRO)!;
  const freePlan = plans.find((p) => p.planId === BillingPlanId.FREE)!;

  await prisma.subscription.upsert({
    where: { tenantId: tenantA.id },
    update: {},
    create: {
      tenantId: tenantA.id,
      planId: proPlan.id,
      status: "ACTIVE",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.subscription.upsert({
    where: { tenantId: tenantB.id },
    update: {},
    create: {
      tenantId: tenantB.id,
      planId: freePlan.id,
      status: "TRIAL",
      currentPeriodStart: new Date(),
      trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });

  // ============================================================================
  // TENANT MEMBERS
  // ============================================================================
  const adminMemberA = await prisma.tenantMember.upsert({
    where: { tenantId_email: { tenantId: tenantA.id, email: testUsers.tenantAdminA.email! } },
    update: {},
    create: {
      tenantId: tenantA.id,
      userId: testUsers.tenantAdminA.id,
      name: testUsers.tenantAdminA.name,
      email: testUsers.tenantAdminA.email,
      role: "TENANT_ADMIN",
      status: "ACTIVE",
    },
  });

  const operatorMemberA = await prisma.tenantMember.upsert({
    where: { tenantId_email: { tenantId: tenantA.id, email: testUsers.operator.email! } },
    update: {},
    create: {
      tenantId: tenantA.id,
      userId: testUsers.operator.id,
      name: testUsers.operator.name,
      email: testUsers.operator.email,
      role: "OPERATOR",
      status: "ACTIVE",
    },
  });

  const residentMemberA = await prisma.tenantMember.upsert({
    where: { tenantId_email: { tenantId: tenantA.id, email: testUsers.resident.email! } },
    update: {},
    create: {
      tenantId: tenantA.id,
      userId: testUsers.resident.id,
      name: testUsers.resident.name,
      email: testUsers.resident.email,
      role: "RESIDENT",
      status: "ACTIVE",
    },
  });

  const adminMemberB = await prisma.tenantMember.upsert({
    where: { tenantId_email: { tenantId: tenantB.id, email: testUsers.tenantAdminB.email! } },
    update: {},
    create: {
      tenantId: tenantB.id,
      userId: testUsers.tenantAdminB.id,
      name: testUsers.tenantAdminB.name,
      email: testUsers.tenantAdminB.email,
      role: "TENANT_ADMIN",
      status: "ACTIVE",
    },
  });

  const residentMemberB = await prisma.tenantMember.upsert({
    where: { tenantId_email: { tenantId: tenantB.id, email: testUsers.residentB.email! } },
    update: {},
    create: {
      tenantId: tenantB.id,
      userId: testUsers.residentB.id,
      name: testUsers.residentB.name,
      email: testUsers.residentB.email,
      role: "RESIDENT",
      status: "ACTIVE",
    },
  });
  console.log(`✅ Tenant members created`);

  // ============================================================================
  // MEMBERSHIPS & ROLES
  // ============================================================================
  async function upsertMembership(params: { tenantId: string; userId: string; role: Role }) {
    const membership = await prisma.membership.upsert({
      where: { userId_tenantId: { userId: params.userId, tenantId: params.tenantId } },
      update: {},
      create: { tenantId: params.tenantId, userId: params.userId },
    });

    try {
      await prisma.membershipRole.create({
        data: { tenantId: params.tenantId, membershipId: membership.id, role: params.role, scopeType: "TENANT" },
      });
    } catch (_e: unknown) {
      if ((_e as { code?: string }).code !== "P2002") throw _e;
    }
    return membership;
  }

  const adminMembershipA = await upsertMembership({ tenantId: tenantA.id, userId: testUsers.tenantAdminA.id, role: Role.TENANT_ADMIN });
  await upsertMembership({ tenantId: tenantA.id, userId: testUsers.operator.id, role: Role.OPERATOR });
  await upsertMembership({ tenantId: tenantA.id, userId: testUsers.resident.id, role: Role.RESIDENT });
  await upsertMembership({ tenantId: tenantB.id, userId: testUsers.tenantAdminB.id, role: Role.TENANT_ADMIN });
  await upsertMembership({ tenantId: tenantB.id, userId: testUsers.residentB.id, role: Role.RESIDENT });

  // Super admin membership
  const superAdminMembership = await prisma.membership.upsert({
    where: { userId_tenantId: { userId: testUsers.superAdmin.id, tenantId: tenantA.id } },
    update: {},
    create: { tenantId: tenantA.id, userId: testUsers.superAdmin.id },
  });
  try {
    await prisma.membershipRole.create({
      data: { tenantId: tenantA.id, membershipId: superAdminMembership.id, role: Role.SUPER_ADMIN, scopeType: "TENANT" },
    });
  } catch { /* ignore duplicate */ }
  console.log(`✅ Memberships & roles created`);

  // ============================================================================
  // BUILDINGS
  // ============================================================================
  const buildingA1 = await prisma.building.upsert({
    where: { tenantId_name: { tenantId: tenantA.id, name: "Torre A Test" } },
    update: {},
    create: {
      tenantId: tenantA.id,
      alias: "A",
      name: "Torre A Test",
      address: "Av. Test 1234, Ciudad A",
    },
  });

  const buildingA2 = await prisma.building.upsert({
    where: { tenantId_name: { tenantId: tenantA.id, name: "Torre B Test" } },
    update: {},
    create: {
      tenantId: tenantA.id,
      alias: "B",
      name: "Torre B Test",
      address: "Calle Test 567, Ciudad A",
    },
  });

  const buildingB1 = await prisma.building.upsert({
    where: { tenantId_name: { tenantId: tenantB.id, name: "Edificio Test B" } },
    update: {},
    create: {
      tenantId: tenantB.id,
      alias: "A",
      name: "Edificio Test B",
      address: "Av. Demo 999, Ciudad B",
    },
  });
  console.log(`✅ Buildings: A1 (${buildingA1.id}), A2 (${buildingA2.id}), B1 (${buildingB1.id})`);

  // ============================================================================
  // UNITS (Tenant A - Building A1: 5 unidades)
  // ============================================================================
  const unitsA1: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const code = `A1-10${i}`;
    const unit = await prisma.unit.upsert({
      where: { buildingId_code: { buildingId: buildingA1.id, code } },
      update: {},
      create: {
        tenantId: tenantA.id,
        buildingId: buildingA1.id,
        code,
        label: `Unidad ${code}`,
        unitType: "APARTMENT",
        occupancyStatus: "OCCUPIED",
        m2: 40 + i * 5,
      },
    });
    unitsA1.push(unit.id);
  }

  // Units for Building A2 (3 unidades)
  const unitsA2: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const code = `A2-20${i}`;
    const unit = await prisma.unit.upsert({
      where: { buildingId_code: { buildingId: buildingA2.id, code } },
      update: {},
      create: {
        tenantId: tenantA.id,
        buildingId: buildingA2.id,
        code,
        label: `Unidad ${code}`,
        unitType: "APARTMENT",
        occupancyStatus: "OCCUPIED",
        m2: 50 + i * 5,
      },
    });
    unitsA2.push(unit.id);
  }

  // Units for Building B1 (3 unidades)
  const unitsB1: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const code = `B1-30${i}`;
    const unit = await prisma.unit.upsert({
      where: { buildingId_code: { buildingId: buildingB1.id, code } },
      update: {},
      create: {
        tenantId: tenantB.id,
        buildingId: buildingB1.id,
        code,
        label: `Unidad ${code}`,
        unitType: "APARTMENT",
        occupancyStatus: "OCCUPIED",
        m2: 45 + i * 5,
      },
    });
    unitsB1.push(unit.id);
  }
  console.log(`✅ Units: A1(5), A2(3), B1(3)`);

  // ============================================================================
  // UNIT OCCUPANTS
  // ============================================================================
  await prisma.unitOccupant.upsert({
    where: { unitId_memberId: { unitId: unitsA1[0]!, memberId: adminMemberA.id } },
    update: {},
    create: { tenantId: tenantA.id, unitId: unitsA1[0]!, memberId: adminMemberA.id, role: "OWNER" },
  });
  await prisma.unitOccupant.upsert({
    where: { unitId_memberId: { unitId: unitsA1[1]!, memberId: residentMemberA.id } },
    update: {},
    create: { tenantId: tenantA.id, unitId: unitsA1[1]!, memberId: residentMemberA.id, role: "RESIDENT" },
  });
  await prisma.unitOccupant.upsert({
    where: { unitId_memberId: { unitId: unitsA1[2]!, memberId: operatorMemberA.id } },
    update: {},
    create: { tenantId: tenantA.id, unitId: unitsA1[2]!, memberId: operatorMemberA.id, role: "OWNER" },
  });

  await prisma.unitOccupant.upsert({
    where: { unitId_memberId: { unitId: unitsB1[0]!, memberId: adminMemberB.id } },
    update: {},
    create: { tenantId: tenantB.id, unitId: unitsB1[0]!, memberId: adminMemberB.id, role: "OWNER" },
  });
  await prisma.unitOccupant.upsert({
    where: { unitId_memberId: { unitId: unitsB1[1]!, memberId: residentMemberB.id } },
    update: {},
    create: { tenantId: tenantB.id, unitId: unitsB1[1]!, memberId: residentMemberB.id, role: "RESIDENT" },
  });
  console.log(`✅ Unit occupants assigned`);

  // ============================================================================
  // FINANCE: Charges & Liquidations for April 2026 (current month)
  // ============================================================================
  const currentPeriod = "2026-04";
  const currency = "ARS";
  const expenseSnapshot = [
    buildSeedExpenseSnapshotItem({
      expenseId: `seed-expense-${currentPeriod}`,
      categoryName: "Test Expense",
      vendorName: "Seed Vendor",
      amountMinor: 500000,
      currencyCode: currency,
      invoiceDate: new Date(`${currentPeriod}-01T00:00:00.000Z`),
      description: "Test liquidation expense snapshot",
      type: "EXPENSE",
    }),
  ];

  // Create a published liquidation for Tenant A, Building A1
  const liquidationWorkflowResult = await ensureSeedPublishedLiquidation({
    prisma,
    tenantId: tenantA.id,
    buildingId: buildingA1.id,
    membershipId: adminMembershipA.id,
    period: currentPeriod,
    chargePeriod: currentPeriod,
    baseCurrency: currency,
    totalAmountMinor: 500000,
    totalsByCurrency: { ARS: 500000 },
    expenseSnapshot,
    units: unitsA1.map((unitId, index) => ({
      id: unitId,
      code: `A1-10${index + 1}`,
      label: `Unidad A1-10${index + 1}`,
    })),
    dueDate: new Date(`${currentPeriod}-15T00:00:00.000Z`),
    notificationPolicy: 'disabled',
  });

  let liquidationA1 = await prisma.liquidation.findUniqueOrThrow({
    where: { id: liquidationWorkflowResult.id },
  });

  const expectedTotals = { ARS: 500000 };
  if (liquidationA1.baseCurrency !== currency || liquidationA1.totalAmountMinor !== 500000 ||
      liquidationA1.unitCount !== unitsA1.length || liquidationA1.chargePeriod !== null && liquidationA1.chargePeriod !== currentPeriod ||
      JSON.stringify(liquidationA1.totalsByCurrency) !== JSON.stringify(expectedTotals) ||
      !Array.isArray(liquidationA1.expenseSnapshot) ||
      liquidationA1.expenseSnapshot.length !== 1) {
    throw new Error(`Test liquidation ${liquidationA1.id} does not match the expected fixture`);
  }
  const [snapshotExpense] = liquidationA1.expenseSnapshot as Array<{ amountMinor?: number; currencyCode?: string }>;
  if (!snapshotExpense || snapshotExpense.amountMinor !== 500000 || snapshotExpense.currencyCode !== currency) {
    throw new Error(`Test liquidation ${liquidationA1.id} snapshot expense does not match the expected fixture`);
  }
  const chargesA1 = await prisma.charge.findMany({
    where: {
      tenantId: tenantA.id,
      buildingId: buildingA1.id,
      liquidationId: liquidationA1.id,
      period: currentPeriod,
    },
    orderBy: { unitId: "asc" },
  });
  if (chargesA1.length !== unitsA1.length) {
    throw new Error(`Expected ${unitsA1.length} generated charges but got ${chargesA1.length}`);
  }

  await prisma.charge.update({
    where: { id: chargesA1[0]!.id },
    data: {
      status: ChargeStatus.PAID,
    },
  });

  // Create one SUBMITTED payment
  await prisma.payment.upsert({
    where: { id: `payment-test-submitted-apr-2026` },
    update: {},
    create: {
      id: `payment-test-submitted-apr-2026`,
      tenantId: tenantA.id,
      buildingId: buildingA1.id,
      unitId: unitsA1[1],
      amount: chargesA1[1]!.amount,
      currency,
      method: PaymentMethod.TRANSFER,
      status: PaymentStatus.SUBMITTED,
      paidAt: new Date(),
      reference: "TEST-REF-001",
      createdByUserId: testUsers.resident.id,
    },
  });
  console.log(`✅ Finances: Liquidation + ${unitsA1.length} charges + 1 payment created`);

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log(`
================================================================================
📋 RESUMEN SEED DE TEST
================================================================================

👤 USUARIOS DE TEST (password: TestPass123!):
   Super Admin:  test-superadmin@buildingos.local
   Admin A:      test-tenant-admin-a@buildingos.local
   Admin B:      test-tenant-admin-b@buildingos.local
   Operador:     test-operator@buildingos.local
   Residente A:  test-resident@buildingos.local
   Residente B:  test-resident-b@buildingos.local

🏢 TENANTS:
   Tenant A: ${tenantA.id} (ADMINISTRADORA, PRO)
   Tenant B: ${tenantB.id} (EDIFICIO_AUTOGESTION, FREE)

🏠 EDIFICIOS:
   Torre A Test:      ${buildingA1.id} (5 unidades)
   Torre B Test:      ${buildingA2.id} (3 unidades)
   Edificio Test B:   ${buildingB1.id} (3 unidades)

💰 FINANZAS (Período: ${currentPeriod}):
   Liquidación: ${liquidationA1.id} (PUBLISHED)
   Charges: ${unitsA1.length} (1 PAID, resto PENDING)
   Payment: 1 SUBMITTED (a validar)

✅ SEED COMPLETADO
================================================================================
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
