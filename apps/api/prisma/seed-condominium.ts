/**
 * CONDOMINIUM SEED SCRIPT
 * 
 * Creates a realistic multi-condominium scenario:
 * - 4 administrations (tenants)
 * - 2 buildings per administration (Torre A, Torre B)
 * - 20 apartments per building
 * - 3 unit categories by m2 in one building of each admin
 * - 1 resident per apartment (primary occupant)
 * - Realistic debt distribution
 * 
 * Usage:
 *   npx ts-node prisma/seed-condominium.ts
 * 
 * Credentials: all users use password "Demo2026!"
 */

import { PrismaClient, Role, TenantType, ChargeStatus, UnitOccupantRole, MemberStatus } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

const PASSWORD = "Demo2026!";

const ADMINISTRATIONS = [
  { name: "Condominio Los Parques", code: "LP" },
  { name: "Condominio Vista Verde", code: "VV" },
  { name: "Condominio Solar del Valle", code: "SV" },
  { name: "Condominio Mirador Real", code: "MR" },
];

const BUILDINGS_PER_ADMIN = 2;
const UNITS_PER_BUILDING = 20;

const CATEGORIES = [
  { name: "Tipo A - Standard", minM2: 40, maxM2: 60, coefficient: 1.0 },
  { name: "Tipo B - Superior", minM2: 61, maxM2: 85, coefficient: 1.5 },
  { name: "Tipo C - Penthouse", minM2: 86, maxM2: 120, coefficient: 2.0 },
];

const MONTHLY_EXPENSES = {
  "Tipo A - Standard": 15000,
  "Tipo B - Superior": 22000,
  "Tipo C - Penthouse": 35000,
};

interface UnitData {
  unit: any;
  category: any;
  building: any;
  floor: number;
  apt: number;
}

async function main() {
  console.log("🏠 Starting Condominium Seed - BuildingOS\n");
  console.log("=".repeat(60));
  
  const hashedPassword = await bcrypt.hash(PASSWORD, 10);
  console.log(`🔐 Password for all users: ${PASSWORD}\n`);

  const allCredentials: { email: string; role: string; building: string; unit?: string }[] = [];

  for (const admin of ADMINISTRATIONS) {
    console.log(`\n📂 Creating: ${admin.name}`);
    console.log("-".repeat(50));

    // Create tenant
    const tenant = await prisma.tenant.upsert({
      where: { name: admin.name },
      update: {},
      create: {
        name: admin.name,
        type: "EDIFICIO_AUTOGESTION" as TenantType,
      },
    });

    // Create admin user (TENANT_OWNER)
    const ownerEmail = `owner.${admin.code.toLowerCase()}@demo.com`;
    const ownerUser = await prisma.user.upsert({
      where: { email: ownerEmail },
      update: { passwordHash: hashedPassword },
      create: {
        email: ownerEmail,
        name: `Administrador ${admin.name}`,
        passwordHash: hashedPassword,
      },
    });

    // Create membership for owner
    const ownerMembership = await prisma.membership.upsert({
      where: { userId_tenantId: { userId: ownerUser.id, tenantId: tenant.id } },
      update: {},
      create: { tenantId: tenant.id, userId: ownerUser.id },
    });

    // Create membership role (no unique constraint on membershipId+role, so use try/catch)
    try {
      await prisma.membershipRole.create({
        data: {
          membershipId: ownerMembership.id,
          role: "TENANT_OWNER" as Role,
          scopeType: "TENANT" as any,
        },
      });
    } catch (e) {
      // Already exists
    }

    // Create TenantMember for owner
    try {
      await prisma.tenantMember.create({
        data: {
          tenantId: tenant.id,
          userId: ownerUser.id,
          name: ownerUser.name,
          email: ownerEmail,
          role: "TENANT_OWNER" as Role,
          status: "ACTIVE" as any,
        },
      });
    } catch (e) {
      // Update
      await prisma.tenantMember.updateMany({
        where: { tenantId: tenant.id, email: ownerEmail },
        data: { userId: ownerUser.id, status: "ACTIVE" as any },
      });
    }

    allCredentials.push({ email: ownerEmail, role: "ADMIN", building: admin.name });
    console.log(`  ✅ Admin: ${ownerEmail}`);

    // Create buildings
    const buildings: any[] = [];
    for (let b = 1; b <= BUILDINGS_PER_ADMIN; b++) {
      const buildingName = b === 1 ? `Torre A` : `Torre B`;
      const building = await prisma.building.upsert({
        where: { id: `${admin.code}-B${b}` },
        update: {},
        create: {
          id: `${admin.code}-B${b}`,
          tenantId: tenant.id,
          name: `${buildingName} - ${admin.name}`,
          address: `Av. Principal ${b}, Ciudad`,
        },
      });
      buildings.push(building);
      console.log(`  ✅ Building: ${buildingName}`);
    }

    // Create unit categories only in first building of each admin (Tower A)
    const categoriesWithIds: any[] = [];
    for (const cat of CATEGORIES) {
      const createdCat = await prisma.unitCategory.upsert({
        where: { buildingId_name: { buildingId: buildings[0].id, name: cat.name } },
        update: {},
        create: {
          tenantId: tenant.id,
          buildingId: buildings[0].id,
          name: cat.name,
          minM2: cat.minM2,
          maxM2: cat.maxM2,
          coefficient: cat.coefficient,
          active: true,
        },
      });
      categoriesWithIds.push(createdCat);
    }
    console.log(`  ✅ Categories created for Torre A (${categoriesWithIds.length} categories)`);

    // Create units
    const unitsData: UnitData[] = [];
    let unitNumber = 1;

    for (let bIndex = 0; bIndex < buildings.length; bIndex++) {
      const building = buildings[bIndex];
      const isCategoryBuilding = bIndex === 0;

      console.log(`\n  📦 Creating units for ${building.name}...`);

      for (let floor = 1; floor <= 4; floor++) {
        for (let apt = 1; apt <= 5; apt++) {
          const label = `${floor}0${apt}`;
          const m2 = 40 + Math.floor(Math.random() * 80);
          
          let unitCategoryId = null;
          if (isCategoryBuilding) {
            const assignedCat = categoriesWithIds.find(
              c => m2 >= c.minM2 && (!c.maxM2 || m2 <= c.maxM2)
            );
            unitCategoryId = assignedCat?.id || null;
          }

          const unit = await prisma.unit.upsert({
            where: {
              buildingId_code: { buildingId: building.id, code: label },
            },
            update: {},
            create: {
              buildingId: building.id,
              code: label,
              label,
              unitType: "APARTMENT",
              occupancyStatus: "OCCUPIED",
              m2: m2,
              unitCategoryId,
            },
          });

          const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
          unitsData.push({ unit, category, building, floor, apt });

          // Create resident user
          const residentEmail = `resident.${admin.code.toLowerCase()}.${unitNumber}@demo.com`;
          const residentName = `Residente ${unitNumber} - ${building.name} - Piso ${floor} Depto ${apt}`;
          
          const residentUser = await prisma.user.upsert({
            where: { email: residentEmail },
            update: { passwordHash: hashedPassword },
            create: {
              email: residentEmail,
              name: residentName,
              passwordHash: hashedPassword,
            },
          });

          // Create membership
          const residentMember = await prisma.membership.upsert({
            where: { userId_tenantId: { userId: residentUser.id, tenantId: tenant.id } },
            update: {},
            create: { tenantId: tenant.id, userId: residentUser.id },
          });

// Create membership role (no unique constraint, use try/catch)
    try {
      await prisma.membershipRole.create({
        data: {
          membershipId: residentMember.id,
          role: "RESIDENT" as Role,
          scopeType: "TENANT" as any,
        },
      });
    } catch (e) {
      // Already exists
    }

    // Create TenantMember (no unique constraint on tenantId_email with userId)
    try {
      await prisma.tenantMember.create({
        data: {
          tenantId: tenant.id,
          userId: residentUser.id,
          name: residentName,
          email: residentEmail,
          role: "RESIDENT" as Role,
          status: "ACTIVE" as any,
        },
      });
    } catch (e) {
      await prisma.tenantMember.updateMany({
        where: { tenantId: tenant.id, email: residentEmail },
        data: { userId: residentUser.id, status: "ACTIVE" as any },
      });
    }

    // Get TenantMember for UnitOccupant
    const residentTenantMember = await prisma.tenantMember.findFirst({
      where: { tenantId: tenant.id, email: residentEmail },
    });

    // Create UnitOccupant
    if (residentTenantMember) {
      try {
        await prisma.unitOccupant.create({
          data: {
            tenantId: tenant.id,
            unitId: unit.id,
            memberId: residentTenantMember.id,
            role: "OWNER" as UnitOccupantRole,
            isPrimary: true,
          },
        });
      } catch (e) {
        // Already exists
      }
    }

          allCredentials.push({ 
            email: residentEmail, 
            role: "RESIDENT", 
            building: building.name,
            unit: label 
          });

          console.log(`    ✅ Unit ${label}: ${residentEmail}`);
          unitNumber++;
        }
      }
    }

    console.log(`\n  💰 Creating charges with debt simulation...`);

    // Create charges for current month and 2 previous months
    const now = new Date();
    const months = [
      { year: now.getFullYear(), month: now.getMonth() + 1, label: "actual" },
      { year: now.getFullYear(), month: now.getMonth(), label: "anterior" },
      { year: now.getFullYear(), month: now.getMonth() - 1, label: "2 meses" },
    ];

    for (const { unit, category, building } of unitsData) {
      const monthlyAmount = MONTHLY_EXPENSES[category.name as keyof typeof MONTHLY_EXPENSES] || 0;
      const isOverdue = Math.random() > 0.55;
      const monthsOverdue = isOverdue ? (Math.random() > 0.5 ? 1 : Math.floor(Math.random() * 2) + 1) : 0;

      for (let m = 0; m <= monthsOverdue; m++) {
        const monthData = months[m];
        const monthDate = new Date(monthData.year, monthData.month - 1, 10);
        const period = `${monthData.year}-${String(monthData.month).padStart(2, '0')}`;

        let status: ChargeStatus = ChargeStatus.PAID;
        if (m === monthsOverdue && monthsOverdue > 0) {
          status = Math.random() > 0.4 ? ChargeStatus.PENDING : ChargeStatus.PARTIAL;
        } else if (m === monthsOverdue && monthsOverdue === 0) {
          status = Math.random() > 0.9 ? ChargeStatus.PENDING : ChargeStatus.PAID;
        }

        await prisma.charge.upsert({
          where: { unitId_period_concept: { unitId: unit.id, period, concept: `Expensas Comunes ${period}` } },
          update: { status },
          create: {
            tenantId: tenant.id,
            buildingId: building.id,
            unitId: unit.id,
            period,
            type: "COMMON_EXPENSE",
            concept: `Expensas Comunes ${period}`,
            amount: monthlyAmount,
            currency: "ARS",
            dueDate: monthDate,
            status,
          },
        });

        // Create partial payment for some units with debt
        if (status === ChargeStatus.PARTIAL && Math.random() > 0.3) {
          const unitOccupants = await prisma.unitOccupant.findMany({
            where: { unitId: unit.id, isPrimary: true },
            include: { member: { include: { user: true } } },
          });

          if (unitOccupants.length > 0 && unitOccupants[0].member.userId) {
            const paymentAmount = Math.floor(monthlyAmount * (0.3 + Math.random() * 0.4));
            
            const payment = await prisma.payment.create({
              data: {
                tenantId: tenant.id,
                buildingId: building.id,
                unitId: unit.id,
                amount: paymentAmount,
                currency: "ARS",
                method: "TRANSFER",
                status: "SUBMITTED",
                reference: `TRF-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`,
                createdByUserId: unitOccupants[0].member.userId,
              },
            });

            // Find the charge for allocation
            const charge = await prisma.charge.findFirst({
              where: { unitId: unit.id, period, status: { not: ChargeStatus.PAID } },
            });

            if (charge) {
              await prisma.paymentAllocation.create({
                data: {
                  tenantId: tenant.id,
                  paymentId: payment.id,
                  chargeId: charge.id,
                  amount: paymentAmount,
                },
              });
            }
          }
        }
      }
    }

    // Stats
    const totalCharges = await prisma.charge.count({ where: { tenantId: tenant.id } });
    const pendingCharges = await prisma.charge.count({ where: { tenantId: tenant.id, status: ChargeStatus.PENDING } });
    const partialCharges = await prisma.charge.count({ where: { tenantId: tenant.id, status: ChargeStatus.PARTIAL } });
    const overdueCharges = await prisma.charge.count({ where: { tenantId: tenant.id, status: { in: [ChargeStatus.PENDING, ChargeStatus.PARTIAL] } } });

    console.log(`\n  📊 Stats: ${totalCharges} charges, ${pendingCharges} pending, ${partialCharges} partial, ${overdueCharges} with debt`);

    console.log(`\n  ✅ ${admin.name} complete!`);
  }

  // Final summary
  console.log("\n" + "=".repeat(60));
  console.log("🎉 CONDOMINIUM SEED COMPLETE!");
  console.log("=".repeat(60));

  const totalUsers = await prisma.user.count();
  const totalTenants = await prisma.tenant.count();
  const totalBuildings = await prisma.building.count();
  const totalUnits = await prisma.unit.count();
  const totalCharges = await prisma.charge.count();
  const totalWithDebt = await prisma.charge.count({ where: { status: { in: [ChargeStatus.PENDING, ChargeStatus.PARTIAL] } } });

  console.log(`\n📊 Total counts:`);
  console.log(`  • Tenants (Administrations): ${totalTenants}`);
  console.log(`  • Buildings: ${totalBuildings}`);
  console.log(`  • Units (Apartments): ${totalUnits}`);
  console.log(`  • Users: ${totalUsers}`);
  console.log(`  • Charges: ${totalCharges}`);
  console.log(`  • Units with debt: ${totalWithDebt}`);

  console.log(`\n📝 Credentials (password: ${PASSWORD}):`);
  console.log("\n  ADMIN OWNERS:");
  const admins = allCredentials.filter(c => c.role === "ADMIN");
  for (const a of admins) {
    console.log(`    • ${a.email}`);
  }

  console.log("\n  RESIDENTS (sample):");
  const residents = allCredentials.filter(c => c.role === "RESIDENT");
  for (const r of residents.slice(0, 8)) {
    console.log(`    • ${r.email} (${r.building} - Unit ${r.unit})`);
  }
  console.log(`    ... and ${residents.length - 8} more`);

  console.log(`\n✅ All users can login with: email + "${PASSWORD}"`);
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());