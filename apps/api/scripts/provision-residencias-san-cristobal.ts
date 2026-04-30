import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { PrismaClient, Prisma, Role, ChargeType, PaymentMethod, TicketPriority, ProcessStatus, BillingPlanId } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

interface ProvisionOptions {
  months?: number;
  buildings?: number;
  floors?: number;
  unitsPerFloor?: number;
  seed?: number;
  reset?: boolean;
  dryRun?: boolean;
}

interface SeededRandom {
  next(): number;
  reset(seed: number): void;
}

function createSeededRandom(seed: number): SeededRandom {
  let currentSeed = seed;
  return {
    next() {
      currentSeed = (currentSeed * 1103515245 + 12345) & 0x7fffffff;
      return currentSeed / 0x7fffffff;
    },
    reset(s: number) {
      currentSeed = s;
    },
  };
}

const rng = createSeededRandom(1337);

function randomInt(min: number, max: number): number {
  return Math.floor(rng.next() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
  return rng.next() * (max - min) + min;
}

function randomFromArray<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)] as T;
}

function formatPeriod(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function getMonthsAgo(months: number): { year: number; month: number } {
  const now = new Date();
  const targetMonth = now.getMonth() - months;
  const year = now.getFullYear() + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12 + 1;
  return { year, month };
}

function generateUnitCode(tower: string, floor: number, unit: number): string {
  return `${tower}-${String(floor).padStart(2, '0')}${String(unit).padStart(2, '0')}`;
}

function generateParkingCode(tower: string, index: number): string {
  return `${tower}-P${String(index).padStart(3, '0')}`;
}

interface Counts {
  unitsTotal: number;
  parkingSpotsTotal: number;
  residentsTotal: number;
  paymentsTotal: number;
  ticketsTotal: number;
  processesTotal: number;
  unitSnapshots: number;
  buildingSnapshots: number;
}

interface Samples {
  debtUnits: Array<{ code: string; outstandingMinor: number }>;
  urgentTickets: Array<{ id: string; title: string; priority: string }>;
  pendingProcesses: Array<{ id: string; title: string; status: string }>;
  parkingWithUnit: Array<{ parking: string; unit: string }>;
}

async function createTenantAndUsers(
  tenantName: string,
  options: ProvisionOptions,
): Promise<{ tenantId: string; adminMemberId: string; operatorMemberId: string; adminUserId: string; operatorUserId: string }> {
  rng.reset(options.seed || 1337);

  const existingTenant = await prisma.tenant.findUnique({
    where: { name: tenantName },
  });

  if (existingTenant) {
    if (options.reset) {
      console.log(`[SETUP] Deleting existing tenant: ${tenantName}`);
      await prisma.tenant.delete({ where: { id: existingTenant.id } });
    } else {
      console.log(`[SETUP] Tenant already exists: ${tenantName}, using existing`);
      const members = await prisma.tenantMember.findMany({
        where: { tenantId: existingTenant.id },
        include: { user: true },
      });
      const adminMember = members.find((m) => m.role === 'TENANT_ADMIN');
      const operatorMember = members.find((m) => m.role === 'OPERATOR');
      return {
        tenantId: existingTenant.id,
        adminMemberId: adminMember?.id ?? '',
        operatorMemberId: operatorMember?.id ?? '',
        adminUserId: adminMember?.user?.id ?? '',
        operatorUserId: operatorMember?.user?.id ?? '',
      };
    }
  }

  const createdAt = new Date();
  createdAt.setMonth(createdAt.getMonth() - (options.months || 24));

  const tenant = await prisma.tenant.create({
    data: {
      name: tenantName,
      type: 'ADMINISTRADORA',
      brandName: 'Residencias San Cristobal',
      currency: 'ARS',
      locale: 'es-AR',
      primaryColor: '#1E40AF',
      createdAt,
      updatedAt: createdAt,
    },
  });

  console.log(`[SETUP] Created tenant: ${tenant.id}`);

  const passwordHash = await bcrypt.hash('DevPass!123', 10);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@adminreal.test' },
    update: {},
    create: {
      email: 'admin@adminreal.test',
      name: 'Admin Real',
      passwordHash,
    },
  });

  const operatorUser = await prisma.user.upsert({
    where: { email: 'operador@adminreal.test' },
    update: {},
    create: {
      email: 'operador@adminreal.test',
      name: 'Operador Real',
      passwordHash,
    },
  });

  const adminMember = await prisma.tenantMember.create({
    data: {
      tenantId: tenant.id,
      userId: adminUser.id,
      name: 'Admin Real',
      email: 'admin@adminreal.test',
      role: 'TENANT_ADMIN' as Role,
      status: 'ACTIVE',
    },
  });

  const operatorMember = await prisma.tenantMember.create({
    data: {
      tenantId: tenant.id,
      userId: operatorUser.id,
      name: 'Operador Real',
      email: 'operador@adminreal.test',
      role: 'OPERATOR' as Role,
      status: 'ACTIVE',
    },
  });

  const adminMembership = await prisma.membership.create({
    data: {
      userId: adminUser.id,
      tenantId: tenant.id,
    },
  });

  await prisma.membershipRole.create({
    data: {
      membershipId: adminMembership.id,
      role: 'TENANT_ADMIN' as Role,
    },
  });

  const operatorMembership = await prisma.membership.create({
    data: {
      userId: operatorUser.id,
      tenantId: tenant.id,
    },
  });

  await prisma.membershipRole.create({
    data: {
      membershipId: operatorMembership.id,
      role: 'OPERATOR' as Role,
    },
  });

  console.log(`[SETUP] Created users and members`);

  const plan = await prisma.billingPlan.findUnique({
    where: { planId: BillingPlanId.ENTERPRISE },
  });
  if (!plan) {
    throw new Error('ENTERPRISE plan not found - run seed.ts first');
  }

  await prisma.subscription.upsert({
    where: { tenantId: tenant.id },
    update: { planId: plan.id },
    create: {
      tenantId: tenant.id,
      planId: plan.id,
      status: 'ACTIVE',
    },
  });

  console.log(`[SETUP] Enabled AI (ENTERPRISE plan)`);

  return {
    tenantId: tenant.id,
    adminMemberId: adminMember.id,
    operatorMemberId: operatorMember.id,
    adminUserId: adminUser.id,
    operatorUserId: operatorUser.id,
  };
}

async function createBuildingsAndUnits(
  tenantId: string,
  options: ProvisionOptions,
): Promise<{ buildingIds: string[]; unitIds: string[]; unitCodes: string[] }> {
  rng.reset(options.seed || 1337);

  const numBuildings = options.buildings || 2;
  const numFloors = options.floors || 12;
  const unitsPerFloor = options.unitsPerFloor || 8;

  const buildingIds: string[] = [];
  const unitIds: string[] = [];
  const unitCodes: string[] = [];

  for (let b = 0; b < numBuildings; b++) {
    const towerLetter = String.fromCharCode(65 + b);
    const building = await prisma.building.create({
      data: {
        tenantId,
        name: `Torre ${towerLetter}`,
        address: `Av. San Cristobal ${100 + b * 50}`,
        allocationMode: 'BY_UNIT',
      },
    });
    buildingIds.push(building.id);
    console.log(`[BUILDINGS] Created: ${building.name}`);

    for (let floor = 1; floor <= numFloors; floor++) {
      for (let unit = 1; unit <= unitsPerFloor; unit++) {
        const code = generateUnitCode(towerLetter, floor, unit);
        const createdUnit = await prisma.unit.create({
          data: {
            buildingId: building.id,
            code,
            label: `Torre ${towerLetter} - Piso ${String(floor).padStart(2, '0')} - Depto ${String(unit).padStart(2, '0')}`,
            unitType: 'APARTAMENTO',
            occupancyStatus: 'UNKNOWN',
            m2: randomFloat(45, 120),
            isBillable: true,
          },
        });
        unitIds.push(createdUnit.id);
        unitCodes.push(code);

        const parkingCode = generateParkingCode(towerLetter, unitIds.length);
        await prisma.unit.create({
          data: {
            buildingId: building.id,
            code: parkingCode,
            label: `Puesto ${parkingCode}`,
            unitType: 'ESTACIONAMIENTO',
            occupancyStatus: 'OCCUPIED',
            m2: 12,
            isBillable: true,
          },
        });
      }
    }
  }

  console.log(`[UNITS] Created ${unitIds.length} residential units + ${unitIds.length} parking spots`);

  return { buildingIds, unitIds, unitCodes };
}

async function createOccupants(
  tenantId: string,
  unitIds: string[],
  unitCodes: string[],
  options: ProvisionOptions,
): Promise<{ memberIds: string[]; userCount: { owners: number; renters: number; occupants: number } }> {
  rng.reset((options.seed || 1337) + 1000);

  const memberIds: string[] = [];
  const userCount = { owners: 0, renters: 0, occupants: 0 };
  const months = options.months || 24;

  const passwordHash = await bcrypt.hash('DevPass!123', 10);

  const occupiedUnits = Math.floor(unitIds.length * 0.82);
  const vacantUnits = Math.floor(unitIds.length * 0.1);

  const owners: Array<{ memberId: string; unitIndex: number }> = [];
  const residents: Array<{ memberId: string; unitIndex: number; isRental: boolean }> = [];

  for (let i = 0; i < occupiedUnits; i++) {
    const isRental = rng.next() < 0.25;
    const ownerEmail = `owner${i + 1}@residentetest.test`;

    const ownerUser = await prisma.user.upsert({
      where: { email: ownerEmail },
      update: {},
      create: {
        email: ownerEmail,
        name: `Owner ${i + 1}`,
        passwordHash,
      },
    });

    const ownerMember = await prisma.tenantMember.create({
      data: {
        tenantId,
        userId: ownerUser.id,
        name: `Owner ${i + 1}`,
        email: ownerEmail,
        role: 'TENANT_OWNER',
        status: 'ACTIVE',
      },
    });
    memberIds.push(ownerMember.id);
    userCount.owners++;
    owners.push({ memberId: ownerMember.id, unitIndex: i });

    await prisma.membership.upsert({
      where: { userId_tenantId: { userId: ownerUser.id, tenantId } },
      update: {},
      create: { userId: ownerUser.id, tenantId },
    });

    if (isRental) {
      const renterEmail = `renter${i + 1}@residentetest.test`;

      const renterUser = await prisma.user.upsert({
        where: { email: renterEmail },
        update: {},
        create: {
          email: renterEmail,
          name: `Renter ${i + 1}`,
          passwordHash,
        },
      });

      const renterMember = await prisma.tenantMember.create({
        data: {
          tenantId,
          userId: renterUser.id,
          name: `Renter ${i + 1}`,
          email: renterEmail,
          role: 'RESIDENT',
          status: 'ACTIVE',
        },
      });
      memberIds.push(renterMember.id);
      userCount.renters++;
      residents.push({ memberId: renterMember.id, unitIndex: i, isRental: true });

      await prisma.membership.upsert({
        where: { userId_tenantId: { userId: renterUser.id, tenantId } },
        update: {},
        create: { userId: renterUser.id, tenantId },
      });
    }

    const occupantsCount = rng.next() < 0.6 ? randomInt(1, 2) : rng.next() < 0.95 ? randomInt(3, 4) : randomInt(5, 6);
    for (let j = 0; j < occupantsCount - 1; j++) {
      const occEmail = `occ${i}_${j}@residentetest.test`;

      const occUser = await prisma.user.upsert({
        where: { email: occEmail },
        update: {},
        create: {
          email: occEmail,
          name: `Occupant ${i}_${j}`,
          passwordHash,
        },
      });

      const occMember = await prisma.tenantMember.create({
        data: {
          tenantId,
          userId: occUser.id,
          name: `Occupant ${i}_${j}`,
          email: occEmail,
          role: 'RESIDENT',
          status: 'ACTIVE',
        },
      });
      memberIds.push(occMember.id);
      userCount.occupants++;
      residents.push({ memberId: occMember.id, unitIndex: i, isRental: false });

      await prisma.membership.upsert({
        where: { userId_tenantId: { userId: occUser.id, tenantId } },
        update: {},
        create: { userId: occUser.id, tenantId },
      });
    }
  }

  for (let i = 0; i < owners.length; i++) {
    const owner = owners[i]!;
    const { memberId, unitIndex } = owner;
    const targetUnitId = unitIds[unitIndex] ?? '';
    await prisma.unitOccupant.create({
      data: {
        tenantId,
        unitId: targetUnitId,
        memberId,
        role: 'OWNER',
        isPrimary: true,
        startDate: new Date(Date.now() - randomInt(30, months * 30) * 24 * 60 * 60 * 1000),
      },
    });
  }

  for (const resident of residents) {
    if (resident.memberId && resident.unitIndex !== undefined) {
      const targetUnitId = unitIds[resident.unitIndex] ?? '';
      await prisma.unitOccupant.create({
        data: {
          tenantId,
          unitId: targetUnitId,
          memberId: resident.memberId,
          role: 'RESIDENT',
          isPrimary: false,
          startDate: new Date(Date.now() - randomInt(30, months * 30) * 24 * 60 * 60 * 1000),
        },
      });
    }
  }

  console.log(`[OCCUPANTS] Created ${memberIds.length} members with occupancy (${userCount.owners} owners, ${userCount.renters} renters, ${userCount.occupants} occupants)`);

  return { memberIds, userCount };
}

async function createCharges(
  tenantId: string,
  buildingIds: string[],
  unitIds: string[],
  unitCodes: string[],
  options: ProvisionOptions,
): Promise<void> {
  rng.reset((options.seed || 1337) + 2000);

  const months = options.months || 24;
  const now = new Date();

  console.log(`[CHARGES] Creating ${months * unitIds.length} monthly charges...`);

  for (let m = 0; m < months; m++) {
    const { year, month } = getMonthsAgo(months - 1 - m);
    const period = formatPeriod(year, month);
    const chargeDate = new Date(year, month - 1, 5);

    const charges: Prisma.ChargeCreateManyInput[] = [];

    for (let i = 0; i < unitIds.length; i++) {
      const baseAmount = randomInt(80000, 150000);
      const coef = randomFloat(0.8, 1.2);
      const amount = Math.round(baseAmount * coef);

      const buildingIndex = Math.floor(i / (options.unitsPerFloor! * options.floors!));
      const chargeBuildingId = buildingIds[buildingIndex] ?? buildingIds[0] ?? '';
      charges.push({
        tenantId,
        buildingId: chargeBuildingId,
        unitId: unitIds[i]!,
        period,
        type: ChargeType.COMMON_EXPENSE,
        concept: `Expensas Comunes ${period}`,
        amount,
        currency: 'ARS',
        status: 'PENDING',
        dueDate: chargeDate,
        createdAt: chargeDate,
      });
    }

    for (const chunk of chunkArray(charges, 100)) {
      await prisma.charge.createMany({ data: chunk });
    }

    console.log(`[CHARGES] Month ${period} done`);
  }

  const extraCharges = 6;
  for (let e = 0; e < extraCharges; e++) {
    const randomMonth = randomInt(0, months - 1);
    const { year, month } = getMonthsAgo(randomMonth);
    const period = formatPeriod(year, month);

    for (let i = 0; i < Math.min(10, unitIds.length); i++) {
      const unitIndex = randomInt(0, unitIds.length - 1);
      const buildingIndex = Math.floor(unitIndex / (options.unitsPerFloor! * options.floors!));
      const chargeBuildingId = buildingIds[buildingIndex] ?? buildingIds[0] ?? '';
      const chargeUnitId = unitIds[unitIndex] ?? '';
      await prisma.charge.create({
        data: {
          tenantId,
          buildingId: chargeBuildingId,
          unitId: chargeUnitId,
          period,
          type: ChargeType.EXTRAORDINARY,
          concept: `Gasto Extraordinario ${e + 1}`,
          amount: randomInt(20000, 50000),
          currency: 'ARS',
          status: 'PENDING',
          dueDate: new Date(year, month - 1, 20),
          createdAt: new Date(year, month - 1, 10),
        },
      });
    }
  }

  console.log(`[CHARGES] Created ${months * unitIds.length + extraCharges * 10} charges`);
}

async function createPayments(
  tenantId: string,
  buildingIds: string[],
  unitIds: string[],
  adminUserId: string,
  options: ProvisionOptions,
): Promise<number> {
  rng.reset((options.seed || 1337) + 3000);

  const months = options.months || 24;
  let paymentCount = 0;

  console.log(`[PAYMENTS] Creating payments...`);

  for (let m = 0; m < months; m++) {
    const { year, month } = getMonthsAgo(months - 1 - m);
    const period = formatPeriod(year, month);

    const charges = await prisma.charge.findMany({
      where: { tenantId, period },
      select: { id: true, amount: true, unitId: true },
      take: 150,
    });

    // Precargar map unitId -> buildingId para evitar N+1
    const unitIdsInCharges = [...new Set(charges.map(c => c.unitId))];
    const unitBuildingMap = new Map<string, string>();
    if (unitIdsInCharges.length > 0) {
      const units = await prisma.unit.findMany({
        where: { id: { in: unitIdsInCharges } },
        select: { id: true, buildingId: true },
      });
      for (const u of units) {
        unitBuildingMap.set(u.id, u.buildingId);
      }
    }

    for (const charge of charges) {
      const correctBuildingId = unitBuildingMap.get(charge.unitId) ?? buildingIds[0];
      const rand = rng.next();

      if (rand < 0.88) {
        const paymentAmount = charge.amount;
        const paymentBuildingId = correctBuildingId!;
        const payment = await prisma.payment.create({
          data: {
            tenantId,
            buildingId: paymentBuildingId,
            unitId: charge.unitId,
            amount: paymentAmount,
            status: 'APPROVED',
            method: randomFromArray([PaymentMethod.TRANSFER, PaymentMethod.CASH, PaymentMethod.CARD]),
            reference: `REF-${period}-${paymentCount}`,
            paidAt: new Date(year, month - 1, randomInt(1, 28)),
            createdAt: new Date(year, month - 1, randomInt(1, 10)),
            createdByUserId: adminUserId,
          },
        });

        await prisma.paymentAllocation.create({
          data: {
            tenantId,
            paymentId: payment.id,
            chargeId: charge.id,
            amount: paymentAmount,
          },
        });

        await prisma.charge.update({
          where: { id: charge.id },
          data: { status: 'PAID' },
        });

        paymentCount++;
      } else if (rand < 0.94) {
        const partialAmount = Math.floor(charge.amount * randomFloat(0.3, 0.7));
        const paymentBuildingId = correctBuildingId!;
        const payment = await prisma.payment.create({
          data: {
            tenantId,
            buildingId: paymentBuildingId,
            unitId: charge.unitId,
            amount: partialAmount,
            status: 'APPROVED',
            method: randomFromArray([PaymentMethod.TRANSFER, PaymentMethod.CASH]),
            reference: `REF-PARTIAL-${paymentCount}`,
            paidAt: new Date(year, month - 1, randomInt(1, 28)),
            createdAt: new Date(year, month - 1, randomInt(1, 10)),
            createdByUserId: adminUserId,
          },
        });

        await prisma.paymentAllocation.create({
          data: {
            tenantId,
            paymentId: payment.id,
            chargeId: charge.id,
            amount: partialAmount,
          },
        });

        await prisma.charge.update({
          where: { id: charge.id },
          data: { status: 'PARTIAL' },
        });

        paymentCount++;
      } else if (rand < 0.985) {
        await prisma.charge.update({
          where: { id: charge.id },
          data: { status: 'PENDING' },
        });
      } else if (rand < 0.9975) {
        const paymentBuildingId = correctBuildingId!;
        await prisma.payment.create({
          data: {
            tenantId,
            buildingId: paymentBuildingId,
            unitId: charge.unitId,
            amount: charge.amount,
            status: 'REJECTED',
            method: PaymentMethod.TRANSFER,
            reference: `REF-REJ-${paymentCount}`,
            rejectionReason: 'COMPROBANTE_ILEGIBLE',
            createdAt: new Date(year, month - 1, randomInt(1, 10)),
            createdByUserId: adminUserId,
          },
        });
        paymentCount++;
      } else {
        // SUBMITTED - enviado sin comprobante (~0.25%)
        const paymentBuildingId = correctBuildingId!;
        await prisma.payment.create({
          data: {
            tenantId,
            buildingId: paymentBuildingId,
            unitId: charge.unitId,
            amount: charge.amount,
            status: 'SUBMITTED',
            method: PaymentMethod.TRANSFER,
            reference: `REF-SUB-${paymentCount}`,
            createdAt: new Date(year, month - 1, randomInt(1, 10)),
            createdByUserId: adminUserId,
          },
        });
        paymentCount++;
      }
    }
  }

  console.log(`[PAYMENTS] Created ${paymentCount} payments`);

  return paymentCount;
}

async function createTickets(
  tenantId: string,
  buildingIds: string[],
  unitIds: string[],
  memberIds: string[],
  adminUserId: string,
  options: ProvisionOptions,
): Promise<number> {
  rng.reset((options.seed || 1337) + 4000);

  const months = options.months || 24;
  let ticketCount = 0;

  console.log(`[TICKETS] Creating tickets...`);

  const ticketTypes = [
    { type: 'MAINTENANCE', priority: 'MEDIUM' },
    { type: 'NOISE', priority: 'MEDIUM' },
    { type: 'SECURITY', priority: 'HIGH' },
    { type: 'PARKING', priority: 'HIGH' },
    { type: 'PLUMBING', priority: 'URGENT' },
    { type: 'ELECTRICAL', priority: 'URGENT' },
    { type: 'COMMON_AREA', priority: 'MEDIUM' },
  ];

  for (let m = 0; m < months; m++) {
    const { year, month } = getMonthsAgo(months - 1 - m);
    const ticketsThisMonth = randomInt(50, 70);

    for (let t = 0; t < ticketsThisMonth; t++) {
      const ticketType = randomFromArray(ticketTypes);
      const unitIndex = randomInt(0, unitIds.length - 1);
      const memberIndex = randomInt(0, memberIds.length - 1);

      const createdAt = new Date(year, month - 1, randomInt(1, 28));
      const slaMinutes = ticketType.priority === 'URGENT' ? 2880 : ticketType.priority === 'HIGH' ? 10080 : 20160;
      const isOverdue = rng.next() < 0.12;

      let status = 'OPEN';
      if (!isOverdue && rng.next() < 0.5) {
        status = rng.next() < 0.7 ? 'IN_PROGRESS' : 'CLOSED';
      }

      const ticketBuildingId = buildingIds[randomInt(0, buildingIds.length - 1)] ?? '';
      const ticketUnitId = unitIds[unitIndex] ?? '';
      const ticketCreatorId = adminUserId;

      const ticket = await prisma.ticket.create({
        data: {
          tenantId,
          buildingId: ticketBuildingId,
          unitId: ticketUnitId,
          title: `${ticketType.type} - Issue ${t + 1}`,
          description: `Issue description for ${ticketType.type}`,
          priority: ticketType.priority as TicketPriority,
          status: status as 'OPEN' | 'IN_PROGRESS' | 'CLOSED',
          createdByUserId: ticketCreatorId,
          createdAt,
        },
      });

      if (status === 'CLOSED') {
        const closedAt = new Date(createdAt.getTime() + randomInt(1, slaMinutes / 2) * 60 * 1000);
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { closedAt },
        });
      }

      ticketCount++;
    }
  }

  console.log(`[TICKETS] Created ${ticketCount} tickets`);

  return ticketCount;
}

async function createProcesses(
  tenantId: string,
  buildingIds: string[],
  memberIds: string[],
  options: ProvisionOptions,
): Promise<number> {
  rng.reset((options.seed || 1337) + 5000);

  const months = options.months || 24;
  let processCount = 0;

  console.log(`[PROCESSES] Creating processes...`);

  for (let m = 0; m < months; m++) {
    const { year, month } = getMonthsAgo(months - 1 - m);
    const period = formatPeriod(year, month);

    const firstUserId = memberIds[0] ?? '';
    const secondUserId = memberIds[1] ?? '';

    for (const buildingId of buildingIds) {
      const liquidation = await prisma.processInstance.create({
        data: {
          tenantId,
          buildingId,
          processType: 'LIQUIDATION',
          title: `Liquidación ${period} - ${buildingId === buildingIds[0] ? 'Torre A' : 'Torre B'}`,
          status: randomFromArray([ProcessStatus.PENDING, ProcessStatus.APPROVED, ProcessStatus.REJECTED]),
          createdByUserId: firstUserId,
          period,
          priority: 2,
          createdAt: new Date(year, month - 1, 3),
        },
      });

      if (rng.next() < 0.5) {
        await prisma.processInstance.update({
          where: { id: liquidation.id },
          data: {
            assignedToUserId: secondUserId,
            assignedAt: new Date(year, month - 1, 4),
          },
        });
      }

      processCount++;

      if (rng.next() < 0.3) {
        const expense = await prisma.processInstance.create({
          data: {
            tenantId,
            buildingId,
            processType: 'EXPENSE_VALIDATION',
            title: `Validación gasto extraordinario ${period}`,
            status: randomFromArray([ProcessStatus.PENDING, ProcessStatus.APPROVED, ProcessStatus.REJECTED]),
            createdByUserId: firstUserId,
            period,
            priority: 1,
            createdAt: new Date(year, month - 1, 10),
          },
        });

        processCount++;
      }
    }
  }

  console.log(`[PROCESSES] Created ${processCount} processes`);

  return processCount;
}

async function runSnapshots(tenantId: string, options: ProvisionOptions): Promise<{ unitSnapshots: number; buildingSnapshots: number }> {
  console.log(`[SNAPSHOTS] Generating snapshots directly via Prisma...`);

  const months = options.months || 24;
  let totalUnitSnapshots = 0;
  let totalBuildingSnapshots = 0;

  for (let m = 0; m < months; m++) {
    const { year, month } = getMonthsAgo(months - 1 - m);
    const period = formatPeriod(year, month);
    const asOf = new Date(year, month, 0, 23, 59, 59);

    const buildings = await prisma.building.findMany({
      where: { tenantId },
      select: { id: true },
    });

    for (const building of buildings) {
      const units = await prisma.unit.findMany({
        where: { buildingId: building.id, unitType: 'APARTAMENTO' },
        include: {
          charges: { where: { period }, select: { amount: true } },
          payments: {
            where: {
              status: 'APPROVED',
              paidAt: { lte: asOf },
            },
            select: { amount: true, paymentAllocations: { select: { amount: true } } },
          },
        },
      });

      let buildingCharged = 0;
      let buildingCollected = 0;

      for (const unit of units) {
        const charged = unit.charges.reduce((sum, c) => sum + c.amount, 0);
        const collected = unit.payments.reduce(
          (sum, p) => sum + p.paymentAllocations.reduce((s, a) => s + a.amount, 0),
          0
        );
        const outstanding = charged - collected;
        const overdue = outstanding > 0 && collected < charged * 0.5 ? outstanding : 0;
        const collectionRate = charged > 0 ? Math.round((collected * 10000) / charged) : null;

        await prisma.unitBalanceMonthlySnapshot.upsert({
          where: {
            tenantId_unitId_period_currency: {
              tenantId,
              unitId: unit.id,
              period,
              currency: 'ARS',
            },
          },
          update: {},
          create: {
            tenantId,
            buildingId: building.id,
            unitId: unit.id,
            period,
            asOf,
            currency: 'ARS',
            chargedMinor: charged,
            collectedMinor: collected,
            outstandingMinor: outstanding,
            overdueMinor: overdue,
            collectionRateBp: collectionRate,
          },
        });

        totalUnitSnapshots++;
        buildingCharged += charged;
        buildingCollected += collected;
      }

      const buildingOutstanding = buildingCharged - buildingCollected;
      const buildingOverdue = buildingOutstanding > buildingCharged * 0.3 ? buildingOutstanding : 0;
      const buildingCollectionRate = buildingCharged > 0 ? Math.round((buildingCollected * 10000) / buildingCharged) : null;

      await prisma.buildingBalanceMonthlySnapshot.upsert({
        where: {
          tenantId_buildingId_period_currency: {
            tenantId,
            buildingId: building.id,
            period,
            currency: 'ARS',
          },
        },
        update: {},
        create: {
          tenantId,
          buildingId: building.id,
          period,
          asOf,
          currency: 'ARS',
          unitCount: units.length,
          chargedMinor: buildingCharged,
          collectedMinor: buildingCollected,
          outstandingMinor: buildingOutstanding,
          overdueMinor: buildingOverdue,
          collectionRateBp: buildingCollectionRate,
        },
      });

      totalBuildingSnapshots++;
    }

    console.log(`[SNAPSHOTS] Period ${period}: ${totalUnitSnapshots} unit + ${totalBuildingSnapshots} building (cumulative)`);
  }

  console.log(`[SNAPSHOTS] Total: ${totalUnitSnapshots} unit + ${totalBuildingSnapshots} building`);

  return { unitSnapshots: totalUnitSnapshots, buildingSnapshots: totalBuildingSnapshots };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function getSamples(tenantId: string, unitCodes: string[]): Promise<Samples> {
  const debtUnits = await prisma.charge.aggregate({
    where: { tenantId, status: { in: ['PENDING', 'PARTIAL'] } },
    _sum: { amount: true },
    _count: true,
  });

  const sampleDebt = await prisma.charge.findMany({
    where: { tenantId, status: { in: ['PENDING', 'PARTIAL'] } },
    take: 3,
    include: { unit: true },
    orderBy: { amount: 'desc' },
  });

  const urgentTickets = await prisma.ticket.findMany({
    where: { tenantId, priority: 'URGENT' },
    take: 3,
    select: { id: true, title: true, priority: true },
  });

  const pendingProcesses = await prisma.processInstance.findMany({
    where: { tenantId, status: 'PENDING' },
    take: 3,
    select: { id: true, title: true, status: true },
  });

  const parkingWithUnit = await prisma.unit.findMany({
    where: { unitType: 'ESTACIONAMIENTO', building: { tenantId } },
    take: 3,
    include: { building: true },
  });

  return {
    debtUnits: sampleDebt.map((u) => ({ code: u.unit?.code || 'UNKNOWN', outstandingMinor: u.amount || 0 })),
    urgentTickets: urgentTickets.map((t) => ({ id: t.id, title: t.title, priority: t.priority })),
    pendingProcesses: pendingProcesses.map((p) => ({ id: p.id, title: p.title, status: p.status })),
    parkingWithUnit: parkingWithUnit.map((p) => ({ parking: p.code, unit: 'N/A' })),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const options: ProvisionOptions = {
    months: 24,
    buildings: 2,
    floors: 12,
    unitsPerFloor: 8,
    seed: 1337,
    reset: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]?.replace('--', '') ?? '';
    const [key, value] = arg.split('=');
    const parsedValue = value ?? '';
    if (key === 'months') options.months = parseInt(parsedValue);
    if (key === 'buildings') options.buildings = parseInt(parsedValue);
    if (key === 'floors') options.floors = parseInt(parsedValue);
    if (key === 'unitsPerFloor') options.unitsPerFloor = parseInt(parsedValue);
    if (key === 'seed') options.seed = parseInt(parsedValue);
    if (key === 'reset') options.reset = true;
    if (key === 'dry-run') options.dryRun = true;
    if (key === 'help') {
      console.log(`
Provision Residencias San Cristobal

Usage: npm run provision:residencias -- [options]

Options:
  --months=N          Number of months of history (default: 24)
  --buildings=N       Number of buildings (default: 2)
  --floors=N          Floors per building (default: 12)
  --unitsPerFloor=N   Units per floor (default: 8)
  --seed=N            Random seed for deterministic data (default: 1337)
  --reset             Delete and recreate if exists
  --dry-run           Validate without persisting
  --help              Show this help
      `);
      process.exit(0);
    }
  }

  console.log(`[PROVISION] Starting with options:`, options);
  console.log(`[PROVISION] Seed: ${options.seed}`);

  const startTime = Date.now();

  const tenantName = 'Residencias San Cristobal';
  const { tenantId, adminMemberId, operatorMemberId, adminUserId, operatorUserId } = await createTenantAndUsers(tenantName, options);

  if (options.dryRun) {
    console.log('[DRY-RUN] Would create tenant, exiting');
    return;
  }

  const { buildingIds, unitIds, unitCodes } = await createBuildingsAndUnits(tenantId, options);

  const memberResult = await createOccupants(tenantId, unitIds, unitCodes, options);

  await createCharges(tenantId, buildingIds, unitIds, unitCodes, options);

  const paymentsTotal = await createPayments(tenantId, buildingIds, unitIds, adminUserId, options);

  const ticketsTotal = await createTickets(tenantId, buildingIds, unitIds, memberResult.memberIds, adminUserId, options);

  const processesTotal = await createProcesses(tenantId, buildingIds, [adminMemberId, operatorMemberId], options);

  const { unitSnapshots, buildingSnapshots } = await runSnapshots(tenantId, options);

  const samples = await getSamples(tenantId, unitCodes);

  // Validación post-run para smoke P0-P3
  const [paymentsByBuilding, submittedCount, snapshotsCount] = await Promise.all([
    prisma.payment.groupBy({
      by: ['buildingId'],
      where: { tenantId },
      _count: { id: true },
    }),
    prisma.payment.count({
      where: { tenantId, status: 'SUBMITTED' },
    }),
    prisma.unitBalanceMonthlySnapshot.count({
      where: { tenantId },
    }),
  ]);

  const validation = {
    buildings: buildingIds.length,
    units: unitIds.length,
    paymentsByBuilding: paymentsByBuilding.map(p => ({
      buildingId: p.buildingId,
      count: p._count.id,
    })),
    submittedCount,
    snapshotsCount,
  };

  console.log('\n[VALIDATION]');
  console.log(JSON.stringify(validation, null, 2));

  const durationMs = Date.now() - startTime;

  const output = {
    status: 'SUCCESS',
    seed: options.seed,
    params: {
      months: options.months,
      buildings: options.buildings,
      floors: options.floors,
      unitsPerFloor: options.unitsPerFloor,
    },
    timingMs: durationMs,
    counts: {
      unitsTotal: unitIds.length,
      parkingSpotsTotal: unitIds.length,
      residentsTotal: memberResult.memberIds.length,
      paymentsTotal,
      ticketsTotal,
      processesTotal,
      unitSnapshots,
      buildingSnapshots,
    },
    samples,
  };

  console.log('\n[RESULT]');
  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((e) => {
    console.error('[ERROR]', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });