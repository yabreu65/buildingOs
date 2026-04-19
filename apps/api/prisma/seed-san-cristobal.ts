import {
  PrismaClient,
  TenantType,
  Role,
  MemberStatus,
  ChargeStatus,
  PaymentStatus,
  ExpenseStatus,
  MovementType,
  CatalogScope,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const TENANT_NAME = 'Residencia San Cristóbal';
const CURRENCY = 'USD';
const PASSWORD = 'DevPass!123';

// Configuration for units per floor: 4 small + 3 medium + 1 large = 8 units per floor
const UNIT_M2_SIZES = [
  ...Array(4).fill([60, 65, 70, 75]),   // 4 small: 60-75 m²
  ...Array(3).fill([80, 85, 90, 95]),   // 3 medium: 80-95 m²
  ...Array(1).fill([110, 115, 120, 130]), // 1 large: 110-130 m²
];

// Building expenses (EXP_*) - each building gets its own
const BUILDING_EXPENSE_CATEGORIES = [
  { code: 'EXP_ELEC_BUILDING_INTERNAL', name: 'Electricidad del edificio (áreas comunes internas)', sortOrder: 10 },
  { code: 'EXP_WATER_BUILDING_INTERNAL', name: 'Agua del edificio (áreas comunes internas)', sortOrder: 20 },
  { code: 'EXP_CLEANING_BUILDING', name: 'Limpieza del edificio (personal e insumos)', sortOrder: 30 },
  { code: 'EXP_MAINT_BUILDING_GENERAL', name: 'Mantenimiento general del edificio', sortOrder: 40 },
  { code: 'EXP_REPAIRS_BUILDING', name: 'Reparaciones y arreglos del edificio', sortOrder: 50 },
  { code: 'EXP_CONCIERGE_BUILDING', name: 'Portería / Conserjería del edificio', sortOrder: 60 },
  { code: 'EXP_WATER_SYSTEM_BUILDING', name: 'Sistema de agua del edificio (bombas/hidroneumático)', sortOrder: 70 },
  { code: 'EXP_ACCESS_BUILDING', name: 'Accesos del edificio (portón/cerraduras/cerrajería)', sortOrder: 80 },
  { code: 'EXP_INSURANCE_BUILDING', name: 'Seguro del edificio', sortOrder: 90 },
  { code: 'EXP_TAXES_BUILDING', name: 'Impuestos y contribuciones del edificio', sortOrder: 100 },
  { code: 'EXP_RESERVE_FUND_BUILDING', name: 'Fondo de reserva del edificio', sortOrder: 110 },
];

// Condominium common expenses (CC_*) - shared between buildings
const CONDOMINIUM_COMMON_CATEGORIES = [
  { code: 'CC_ELEC_EXTERNAS', name: 'Electricidad – Áreas comunes externas (medidor común)', sortOrder: 1000 },
  { code: 'CC_ELEC_AMENIDADES', name: 'Electricidad – Amenidades (salón de fiestas)', sortOrder: 1010 },
  { code: 'CC_AGUA_CONJUNTO', name: 'Agua – Áreas comunes del conjunto', sortOrder: 1020 },
  { code: 'CC_ASEO_RESIDUOS', name: 'Aseo urbano y residuos (conjunto)', sortOrder: 1030 },
  { code: 'CC_MANT_INFRA_COMUN', name: 'Mantenimiento de infraestructura común', sortOrder: 1040 },
  { code: 'CC_ADMIN_GENERAL', name: 'Administración general del condominio', sortOrder: 1050 },
  { code: 'CC_LEGAL_CONTAB', name: 'Legales y contabilidad (conjunto)', sortOrder: 1060 },
  { code: 'CC_COMISIONES_BANCARIAS', name: 'Comisiones bancarias (conjunto)', sortOrder: 1070 },
  { code: 'CC_FONDO_RESERVA', name: 'Fondo de reserva del conjunto', sortOrder: 1080 },
];

// Expenses per period (amounts in cents USD)
const PERIOD_EXPENSES: Record<string, { common: Record<string, number>, building: Record<string, number> }> = {
  '2025-12': {
    common: { CC_ELEC_EXTERNAS: 15000, CC_ADMIN_GENERAL: 25000, CC_FONDO_RESERVA: 10000 },
    building: { EXP_ELEC_BUILDING_INTERNAL: 8000, EXP_WATER_BUILDING_INTERNAL: 5000, EXP_CLEANING_BUILDING: 6000 },
  },
  '2026-01': {
    common: { CC_ELEC_EXTERNAS: 18000, CC_ELEC_AMENIDADES: 5000, CC_ASEO_RESIDUOS: 12000, CC_ADMIN_GENERAL: 25000, CC_FONDO_RESERVA: 15000 },
    building: { EXP_ELEC_BUILDING_INTERNAL: 9000, EXP_WATER_BUILDING_INTERNAL: 5500, EXP_CLEANING_BUILDING: 6500, EXP_CONCIERGE_BUILDING: 12000, EXP_RESERVE_FUND_BUILDING: 10000 },
  },
  '2026-02': {
    common: { CC_ELEC_EXTERNAS: 17000, CC_ELEC_AMENIDADES: 4500, CC_ASEO_RESIDUOS: 12000, CC_ADMIN_GENERAL: 25000, CC_LEGAL_CONTAB: 8000, CC_FONDO_RESERVA: 15000 },
    building: { EXP_ELEC_BUILDING_INTERNAL: 8500, EXP_WATER_BUILDING_INTERNAL: 5000, EXP_CLEANING_BUILDING: 6500, EXP_CONCIERGE_BUILDING: 12000, EXP_REPAIRS_BUILDING: 4000, EXP_RESERVE_FUND_BUILDING: 10000 },
  },
  '2026-03': {
    common: { CC_ELEC_EXTERNAS: 19000, CC_ELEC_AMENIDADES: 6000, CC_ASEO_RESIDUOS: 12000, CC_ADMIN_GENERAL: 25000, CC_MANT_INFRA_COMUN: 5000, CC_FONDO_RESERVA: 18000 },
    building: { EXP_ELEC_BUILDING_INTERNAL: 9500, EXP_WATER_BUILDING_INTERNAL: 6000, EXP_CLEANING_BUILDING: 7000, EXP_CONCIERGE_BUILDING: 12000, EXP_WATER_SYSTEM_BUILDING: 3000, EXP_RESERVE_FUND_BUILDING: 10000 },
  },
};

async function main() {
  console.log('🏗️  SEEDER: Residencia San Cristóbal\n');

  // 1. Delete existing tenant if exists
  const existingTenant = await prisma.tenant.findUnique({ where: { name: TENANT_NAME } });
  if (existingTenant) {
    console.log(`→ Deleting existing tenant "${TENANT_NAME}" (cascade)...`);
    await prisma.tenant.delete({ where: { id: existingTenant.id } });
    console.log('  ✅ Deleted\n');
  }

  // 2. Create Tenant
  console.log('1. Creating tenant...');
  const tenant = await prisma.tenant.create({
    data: {
      name: TENANT_NAME,
      type: TenantType.ADMINISTRADORA,
      currency: CURRENCY,
      locale: 'es-VE',
    },
  });
  console.log(`   ✅ Tenant ID: ${tenant.id}\n`);

  // 3. Create Buildings
  console.log('2. Creating buildings...');
  const buildingA = await prisma.building.create({
    data: { tenantId: tenant.id, name: 'Torre A', address: 'Avenida Principal 100' },
  });
  const buildingB = await prisma.building.create({
    data: { tenantId: tenant.id, name: 'Torre B', address: 'Avenida Principal 102' },
  });
  console.log(`   ✅ Torre A: ${buildingA.id}`);
  console.log(`   ✅ Torre B: ${buildingB.id}\n`);

  // 4. Create Units (12 floors x 8 units = 96 per building)
  console.log('3. Creating units (192 total)...');
  const unitIdsA: string[] = [];
  const unitIdsB: string[] = [];
  
  for (let floor = 1; floor <= 12; floor++) {
    for (let unit = 1; unit <= 8; unit++) {
      const code = `${floor.toString().padStart(2, '0')}${unit}`;
      const m2Range = UNIT_M2_SIZES[unit - 1];
      const m2 = Math.floor(Math.random() * (m2Range[1] - m2Range[0]) + m2Range[0]);
      
      const unitA = await prisma.unit.create({
        data: { buildingId: buildingA.id, code, label: `Torre A - Piso ${floor} - Depto ${unit}`, m2: m2, isBillable: true },
      });
      unitIdsA.push(unitA.id);
      
      const unitB = await prisma.unit.create({
        data: { buildingId: buildingB.id, code, label: `Torre B - Piso ${floor} - Depto ${unit}`, m2: m2, isBillable: true },
      });
      unitIdsB.push(unitB.id);
    }
  }
  console.log(`   ✅ Torre A: ${unitIdsA.length} units`);
  console.log(`   ✅ Torre B: ${unitIdsB.length} units\n`);

  // 4b. Create UnitCategories (for m2-based prorrateo)
  console.log('3b. Creating unit categories (prorrateo por m²)...');
  
  const unitCategories = [
    { name: 'Pequeña', minM2: 50, maxM2: 75, coefficient: 1.0 },
    { name: 'Mediana', minM2: 76, maxM2: 100, coefficient: 1.5 },
    { name: 'Grande', minM2: 101, maxM2: 150, coefficient: 2.0 },
  ];
  
  for (const building of [buildingA, buildingB]) {
    for (const cat of unitCategories) {
      await prisma.unitCategory.create({
        data: {
          tenantId: tenant.id,
          buildingId: building.id,
          name: cat.name,
          minM2: cat.minM2,
          maxM2: cat.maxM2,
          coefficient: cat.coefficient,
          active: true,
        },
      });
    }
  }
  console.log(`   ✅ ${unitCategories.length} unit categories per building (prorrateo)\n`);

  // 4c. Auto-assign unit categories based on m2
  console.log('3c. Auto-assigning unit categories based on m2...');
  
  for (const building of [buildingA, buildingB]) {
    const categories = await prisma.unitCategory.findMany({
      where: { buildingId: building.id, active: true },
      orderBy: { minM2: 'asc' },
    });
    
    const units = await prisma.unit.findMany({
      where: { buildingId: building.id, isBillable: true },
    });
    
    for (const unit of units) {
      const matchedCategory = categories.find(cat => 
        unit.m2! >= cat.minM2 && (cat.maxM2 === null || unit.m2! <= cat.maxM2)
      );
      if (matchedCategory) {
        await prisma.unit.update({
          where: { id: unit.id },
          data: { unitCategoryId: matchedCategory.id },
        });
      }
    }
  }
  console.log('   ✅ Unit categories auto-assigned based on m2\n');

  // 5. Create Expense Categories
  console.log('4. Creating expense categories...');
  const categoryMap: Record<string, string> = {};
  
  for (const cat of BUILDING_EXPENSE_CATEGORIES) {
    const created = await prisma.expenseLedgerCategory.create({
      data: {
        tenantId: tenant.id,
        code: cat.code,
        name: cat.name,
        description: cat.name,
        movementType: MovementType.EXPENSE,
        catalogScope: CatalogScope.BUILDING,
        sortOrder: cat.sortOrder,
        isActive: true,
      },
    });
    categoryMap[cat.code] = created.id;
  }
  
  for (const cat of CONDOMINIUM_COMMON_CATEGORIES) {
    const created = await prisma.expenseLedgerCategory.create({
      data: {
        tenantId: tenant.id,
        code: cat.code,
        name: cat.name,
        description: cat.name,
        movementType: MovementType.EXPENSE,
        catalogScope: CatalogScope.CONDOMINIUM_COMMON,
        sortOrder: cat.sortOrder,
        isActive: true,
      },
    });
    categoryMap[cat.code] = created.id;
  }
  console.log(`   ✅ ${BUILDING_EXPENSE_CATEGORIES.length} BUILDING + ${CONDOMINIUM_COMMON_CATEGORIES.length} CONDOMINIUM_COMMON\n`);

  // 6. Create Vendors
  console.log('5. Creating vendors...');
  const vendors: Record<string, string> = {};
  
  const vendorData = [
    { name: 'CORPOELEC', taxId: 'J-00000000', email: 'facturacion@corpoelec.gob.ve' },
    { name: 'HIDROSUROESTE', taxId: 'J-00000001', email: 'facturacion@hidrosuroeste.gob.ve' },
    { name: 'NETUNO', taxId: 'J-00000002', email: 'cobranzas@netuno.com.ve' },
    { name: 'Servicios de Limpieza C.A.', taxId: 'J-00000003', email: 'admin@serviclp.com.ve' },
    { name: 'Antonio Roa - Mantenimiento de Ascensores', taxId: 'J-00000004', email: 'antonioroa@ascensores.com' },
    { name: 'Administración Condominal C.A.', taxId: 'J-00000005', email: 'contabilidad@admincondominal.com.ve' },
  ];
  
  for (const v of vendorData) {
    const created = await prisma.vendor.create({
      data: { tenantId: tenant.id, ...v },
    });
    vendors[v.name] = created.id;
  }
  console.log(`   ✅ ${vendors.length} vendors created\n`);

  // 7. Create Users, Memberships, TenantMembers
  console.log('6. Creating users...');
  const hashedPassword = await bcrypt.hash(PASSWORD, 10);
  
  // Admin user (upsert for idempotency)
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@sancristobal.test' },
    update: {},
    create: { email: 'admin@sancristobal.test', name: 'Admin Residencia San Cristóbal', passwordHash: hashedPassword },
  });
  const adminMember = await prisma.membership.create({
    data: { userId: adminUser.id, tenantId: tenant.id },
  });
  await prisma.membershipRole.create({
    data: { membershipId: adminMember.id, role: Role.TENANT_ADMIN },
  });
  const adminTenantMember = await prisma.tenantMember.create({
    data: { tenantId: tenant.id, userId: adminUser.id, name: 'Admin Residencia San Cristóbal', email: 'admin@sancristobal.test', role: Role.TENANT_ADMIN, status: MemberStatus.ACTIVE },
  });
  console.log(`   ✅ Admin: admin@sancristobal.test / ${PASSWORD}`);

  // Operator user (upsert for idempotency)
  const operatorUser = await prisma.user.upsert({
    where: { email: 'operador@sancristobal.test' },
    update: {},
    create: { email: 'operador@sancristobal.test', name: 'Operador Residencia San Cristóbal', passwordHash: hashedPassword },
  });
  const operatorMember = await prisma.membership.create({
    data: { userId: operatorUser.id, tenantId: tenant.id },
  });
  await prisma.membershipRole.create({
    data: { membershipId: operatorMember.id, role: Role.OPERATOR },
  });
  await prisma.tenantMember.create({
    data: { tenantId: tenant.id, userId: operatorUser.id, name: 'Operador Residencia San Cristóbal', email: 'operador@sancristobal.test', role: Role.OPERATOR, status: MemberStatus.ACTIVE },
  });
  console.log(`   ✅ Operator: operador@sancristobal.test / ${PASSWORD}`);

  // 10 Resident users (upsert for idempotency)
  const residents: { userId: string; memberId: string; name: string; unitId: string; buildingId: string }[] = [];
  for (let i = 1; i <= 10; i++) {
    const email = `res${i.toString().padStart(3, '0')}@sancristobal.test`;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name: `Residente ${i}`, passwordHash: hashedPassword },
    });
    
    // Membership - upsert to avoid duplicates
    const existingMember = await prisma.membership.findFirst({
      where: { userId: user.id, tenantId: tenant.id },
    });
    let member;
    if (existingMember) {
      member = existingMember;
    } else {
      member = await prisma.membership.create({
        data: { userId: user.id, tenantId: tenant.id },
      });
    }
    
    // MembershipRole - upsert
    const existingRole = await prisma.membershipRole.findFirst({
      where: { membershipId: member.id, role: Role.RESIDENT },
    });
    if (!existingRole) {
      await prisma.membershipRole.create({
        data: { membershipId: member.id, role: Role.RESIDENT },
      });
    }
    
    // TenantMember - upsert
    const tenantMember = await prisma.tenantMember.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email } },
      update: {},
      create: { tenantId: tenant.id, userId: user.id, name: user.name, email, role: Role.RESIDENT, status: MemberStatus.ACTIVE },
    });
    
    // Assign to unit (intercalated between towers)
    const unitIdx = i - 1;
    const unitId = i % 2 === 1 ? unitIdsA[unitIdx] : unitIdsB[unitIdx];
    const buildingId = i % 2 === 1 ? buildingA.id : buildingB.id;
    
      await prisma.unitOccupant.create({
        data: { tenantId: tenant.id, unitId: unitId!, memberId: tenantMember.id, role: 'RESIDENT', isPrimary: true },
      });
      
      residents.push({ userId: user.id, memberId: member.id, name: user.name, unitId: unitId!, buildingId });

  }
  console.log(`   ✅ 10 residents created with unit assignments\n`);

  // 6b. Assign residents to ALL remaining vacant units (182 more)
  console.log('6b. Assigning residents to remaining 182 vacant units...');
  
  // Get all units with their current occupants (if any) - using explicit any to bypass type issue
  const allUnits: any = await prisma.unit.findMany({
    where: { buildingId: { in: [buildingA.id, buildingB.id] } },
    include: { unitOccupants: { where: { endDate: null } } },
    orderBy: [{ buildingId: 'asc' }, { code: 'asc' }],
  });
  
  // Filter units that have NO active occupant
  const vacantUnits = allUnits.filter((u: any) => u.unitOccupants.length === 0);
  console.log(`   Found ${vacantUnits.length} vacant units to fill`);
  
  // Create remaining residents (res011 to res192 = 182 users)
  const newResidentCount = vacantUnits.length;
  const createdResidents: { email: string; unitId: string; buildingName: string }[] = [];
  
  for (let i = 0; i < newResidentCount; i++) {
    const resNumber = i + 11; // Start from res011
    const email = `res${resNumber.toString().padStart(3, '0')}@sancristobal.test`;
    
    // Upsert User
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name: `Residente ${resNumber}`, passwordHash: hashedPassword },
    });
    
    // Upsert Membership
    const existingMember = await prisma.membership.findFirst({
      where: { userId: user.id, tenantId: tenant.id },
    });
    let member;
    if (existingMember) {
      member = existingMember;
    } else {
      member = await prisma.membership.create({
        data: { userId: user.id, tenantId: tenant.id },
      });
    }
    
    // Upsert MembershipRole
    const existingRole = await prisma.membershipRole.findFirst({
      where: { membershipId: member.id, role: Role.RESIDENT },
    });
    if (!existingRole) {
      await prisma.membershipRole.create({
        data: { membershipId: member.id, role: Role.RESIDENT },
      });
    }
    
    // Upsert TenantMember
    const tenantMember = await prisma.tenantMember.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email } },
      update: {},
      create: { tenantId: tenant.id, userId: user.id, name: user.name, email, role: Role.RESIDENT, status: MemberStatus.ACTIVE },
    });
    
    // Assign to vacant unit
    const unit: any = vacantUnits[i];
    const buildingName = unit.buildingId === buildingA.id ? 'Torre A' : 'Torre B';
    
    await prisma.unitOccupant.upsert({
      where: { unitId_memberId: { unitId: unit.id, memberId: tenantMember.id } },
      update: {},
      create: { tenantId: tenant.id, unitId: unit.id, memberId: tenantMember.id, role: 'RESIDENT', isPrimary: true },
    });
    
    createdResidents.push({ email, unitId: unit.id, buildingName });
  }
  console.log(`   ✅ ${createdResidents.length} new residents assigned to vacant units\n`);

  // 8. Create Expenses for each period
  console.log('7. Creating expenses...');
  const membershipId = adminMember.id;
  const allUnitIds = [...unitIdsA, ...unitIdsB];
  
  for (const [period, expenses] of Object.entries(PERIOD_EXPENSES)) {
    // Common expenses (TENANT_SHARED)
    for (const [code, amount] of Object.entries(expenses.common)) {
      const categoryId = categoryMap[code]!;
      const expense = await prisma.expense.create({
        data: {
          tenantId: tenant.id,
          period,
          liquidationPeriod: period,
          categoryId,
          scopeType: 'TENANT_SHARED',
          amountMinor: amount,
          currencyCode: CURRENCY,
          invoiceDate: new Date(`${period}-15`),
          description: `${code} - ${period}`,
          status: ExpenseStatus.VALIDATED,
          createdByMembershipId: membershipId,
          validatedByMembershipId: membershipId,
          validatedAt: new Date(),
        },
      });
      
      // Allocate 50/50 between buildings
      const halfAmount = Math.floor(amount / 2);
      await prisma.movementAllocation.create({
        data: { tenantId: tenant.id, expenseId: expense.id, buildingId: buildingA.id, percentage: 50, amountMinor: halfAmount, currencyCode: CURRENCY },
      });
      await prisma.movementAllocation.create({
        data: { tenantId: tenant.id, expenseId: expense.id, buildingId: buildingB.id, percentage: 50, amountMinor: amount - halfAmount, currencyCode: CURRENCY },
      });
    }
    
    // Building-specific expenses (BUILDING)
    for (const building of [buildingA, buildingB]) {
      for (const [code, amount] of Object.entries(expenses.building)) {
        const categoryId = categoryMap[code]!;
        await prisma.expense.create({
          data: {
            tenantId: tenant.id,
            buildingId: building.id,
            period,
            liquidationPeriod: period,
            categoryId,
            scopeType: 'BUILDING',
            amountMinor: amount,
            currencyCode: CURRENCY,
            invoiceDate: new Date(`${period}-15`),
            description: `${code} - ${building.name} - ${period}`,
            status: ExpenseStatus.VALIDATED,
            createdByMembershipId: membershipId,
            validatedByMembershipId: membershipId,
            validatedAt: new Date(),
          },
        });
      }
    }
  }
  console.log(`   ✅ Expenses created for periods: ${Object.keys(PERIOD_EXPENSES).join(', ')}\n`);

  // 9. Create Liquidations and Charges (semántica N+1)
  console.log('8. Creating liquidations and charges...');
  const liquidationResults: { buildingId: string; period: string; status: string; total: number }[] = [];
  const chargeResults: { buildingId: string; chargePeriod: string; count: number; total: number }[] = [];
  
  // chargePeriod = liquidationPeriod + 1 month
  const periodMapping: Record<string, string> = {
    '2025-12': '2026-01',
    '2026-01': '2026-02',
    '2026-02': '2026-03',
    '2026-03': '2026-04',
  };
  
  // Only publish periods 2025-12, 2026-01, 2026-02 (charge periods Jan, Feb, Mar)
  // Keep 2026-03 as DRAFT for user testing
  const periodsToPublish = ['2025-12', '2026-01', '2026-02'];
  
  for (const building of [buildingA, buildingB]) {
    for (const [period, chargePeriod] of Object.entries(periodMapping)) {
      // Calculate total expenses for this building/period
      const buildingExpenses = await prisma.expense.aggregate({
        where: { tenantId: tenant.id, buildingId: building.id, liquidationPeriod: period, status: 'VALIDATED' },
        _sum: { amountMinor: true },
      });
      
      const sharedExpenses = await prisma.expense.findMany({
        where: { tenantId: tenant.id, period, status: 'VALIDATED', scopeType: 'TENANT_SHARED', allocations: { some: { buildingId: building.id } } },
        include: { allocations: true },
      });
      
      const sharedTotal = sharedExpenses.reduce((sum: number, exp: any) => {
        const alloc = exp.allocations.find((a: any) => a.buildingId === building.id);
        return sum + (alloc?.amountMinor ?? Math.floor(exp.amountMinor * (alloc?.percentage ?? 0) / 100));
      }, 0);
      
      const totalAmount = (buildingExpenses._sum.amountMinor ?? 0) + sharedTotal;
      
      // Create liquidation (DRAFT first)
      const liquidation = await prisma.liquidation.create({
        data: {
          tenantId: tenant.id,
          buildingId: building.id,
          period,
          chargePeriod,
          status: 'DRAFT',
          baseCurrency: CURRENCY,
          totalAmountMinor: totalAmount,
          totalsByCurrency: { [CURRENCY]: totalAmount },
          expenseSnapshot: [],
          unitCount: 96,
          generatedByMembershipId: membershipId,
        },
      });
      
      // If publishable, review and publish
      const shouldPublish = periodsToPublish.includes(period);
      if (shouldPublish) {
        await prisma.liquidation.update({ where: { id: liquidation.id }, data: { status: 'REVIEWED' } });
        
        // Get units with m2
        const units = await prisma.unit.findMany({ where: { buildingId: building.id, isBillable: true }, select: { id: true, code: true, m2: true } });
        const totalM2 = units.reduce((sum, u) => sum + (u.m2 ?? 0), 0);
        
        // Create charges
        for (const unit of units) {
          const unitShare = totalM2 > 0 ? (unit.m2 ?? 0) / totalM2 : 1 / units.length;
          const amount = Math.round(totalAmount * unitShare);
          
          // chargePeriod = period + 1
          await prisma.charge.create({
            data: {
              tenantId: tenant.id,
              buildingId: building.id,
              unitId: unit.id,
              period: chargePeriod, // This is correct: charge in next month
              type: 'COMMON_EXPENSE',
              concept: `Expensas comunes ${periodMapping[period] || period}`,
              amount,
              currency: CURRENCY,
              dueDate: new Date(`${chargePeriod}-05`),
              status: ChargeStatus.PENDING,
              liquidationId: liquidation.id,
            },
          });
        }
        
        await prisma.liquidation.update({ where: { id: liquidation.id }, data: { status: 'PUBLISHED', publishedByMembershipId: membershipId, publishedAt: new Date() } });
      }
      
      liquidationResults.push({ buildingId: building.id, period, status: shouldPublish ? 'PUBLISHED' : 'DRAFT', total: totalAmount });
    }
  }
  
  // Get charge counts
  for (const building of [buildingA, buildingB]) {
    for (const [, chargePeriod] of Object.entries(periodMapping)) {
      const charges = await prisma.charge.findMany({ where: { tenantId: tenant.id, buildingId: building.id, period: chargePeriod } });
      chargeResults.push({ buildingId: building.id, chargePeriod, count: charges.length, total: charges.reduce((sum, c) => sum + c.amount, 0) });
    }
  }
  console.log(`   ✅ Liquidations and charges created\n`);

  // 10. Final Summary
  console.log('='.repeat(80));
  console.log('📋 RESUMEN FINAL - Residencia San Cristóbal');
  console.log('='.repeat(80));
  
  console.log('\n🏢 TENANT:');
  console.log(`   Name: ${TENANT_NAME}`);
  console.log(`   tenantId: ${tenant.id}`);
  console.log(`   Currency: ${CURRENCY}`);
  
  console.log('\n🏢 BUILDINGS:');
  console.log(`   Torre A: ${buildingA.id}`);
  console.log(`   Torre B: ${buildingB.id}`);
  
  console.log('\n🏠 UNITS:');
  console.log(`   Torre A: ${unitIdsA.length} unidades`);
  console.log(`   Torre B: ${unitIdsB.length} unidades`);
  console.log(`   Total: ${unitIdsA.length + unitIdsB.length} unidades`);
  
  console.log('\n👥 USUARIOS:');
  console.log(`   Admin: admin@sancristobal.test / ${PASSWORD} (TENANT_ADMIN)`);
  console.log(`   Operator: operador@sancristobal.test / ${PASSWORD} (OPERATOR)`);
  console.log(`   Residentes: res001-res010@sancristobal.test / ${PASSWORD} (RESIDENT)`);
  
  console.log('\n💰 RUBROS:');
  console.log(`   EXP_* (BUILDING): ${BUILDING_EXPENSE_CATEGORIES.length} categorías`);
  console.log(`   CC_* (CONDOMINIUM_COMMON): ${CONDOMINIUM_COMMON_CATEGORIES.length} categorías`);
  
  console.log('\n📊 LIQUIDACIONES:');
  for (const r of liquidationResults) {
    console.log(`   ${r.buildingId === buildingA.id ? 'Torre A' : 'Torre B'} - Período ${r.period}: ${r.status} - Total USD ${(r.total / 100).toFixed(2)}`);
  }
  
  console.log('\n💳 EXPENSAS (CHARGES):');
  for (const cr of chargeResults) {
    if (cr.count > 0) {
      console.log(`   ${cr.buildingId === buildingA.id ? 'Torre A' : 'Torre B'} - Período ${cr.chargePeriod}: ${cr.count} charges - Total USD ${(cr.total / 100).toFixed(2)}`);
    }
  }
  
  console.log('\n✅ SEED COMPLETADO!\n');
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());