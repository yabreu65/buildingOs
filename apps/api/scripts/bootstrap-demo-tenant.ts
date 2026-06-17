import { PrismaClient, TenantType, Role, ScopeType, TicketCategory, TicketPriority, TicketStatus, CommunicationChannel, CommunicationStatus, CommunicationTargetType, ChargeType, ChargeStatus, UnitOccupantRole, PaymentMethod, PaymentStatus, MovementType, CatalogScope } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD || 'DemoPass!123';

async function main() {
  console.log('🚀 Bootstrapping demo tenant...\n');

  try {
    // ── 1. Tenant ──────────────────────────────────────────────────────
    console.log('→ Upserting tenant...');
    const tenant = await prisma.tenant.upsert({
      where: { name: 'Administración Demo' },
      update: { isDemo: true },
      create: {
        name: 'Administración Demo',
        type: TenantType.ADMINISTRADORA,
        isDemo: true,
        currency: 'ARS',
        locale: 'es-AR',
      },
    });
    console.log(`  ✓ Tenant: ${tenant.id} (${tenant.name})\n`);

    // ── 2. Demo User ───────────────────────────────────────────────────
    console.log('→ Upserting demo user...');
    const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 10);
    const user = await prisma.user.upsert({
      where: { email: 'demo@buildingos.app' },
      update: { passwordHash: hashedPassword },
      create: {
        email: 'demo@buildingos.app',
        name: 'Demo',
        passwordHash: hashedPassword,
      },
    });
    console.log(`  ✓ User: ${user.email}\n`);

    // ── 3. Membership ──────────────────────────────────────────────────
    console.log('→ Upserting membership...');
    const membership = await prisma.membership.upsert({
      where: {
        userId_tenantId: { userId: user.id, tenantId: tenant.id },
      },
      update: {},
      create: { userId: user.id, tenantId: tenant.id },
    });
    console.log(`  ✓ Membership: ${membership.id}\n`);

    // ── 4. MembershipRole (TENANT_ADMIN) ───────────────────────────────
    console.log('→ Ensuring TENANT_ADMIN role...');
    const existingRole = await prisma.membershipRole.findFirst({
      where: {
        membershipId: membership.id,
        role: Role.TENANT_ADMIN,
      },
    });
    if (!existingRole) {
      await prisma.membershipRole.create({
        data: {
          tenantId: tenant.id,
          membershipId: membership.id,
          role: Role.TENANT_ADMIN,
          scopeType: ScopeType.TENANT,
        },
      });
      console.log('  ✓ Role TENANT_ADMIN created\n');
    } else {
      console.log('  ✓ Role TENANT_ADMIN already exists\n');
    }

    // ── 5. Buildings ───────────────────────────────────────────────────
    console.log('→ Upserting buildings...');
    const buildingData = [
      {
        name: 'Torre del Parque',
        alias: 'A',
        address: 'Av. del Libertador 500, Piso 12',
      },
      {
        name: 'Edificio del Río',
        alias: 'B',
        address: 'Av. Costanera 1200, Piso 8',
      },
      {
        name: 'Residencias del Sol',
        alias: 'C',
        address: 'Calle Falsa 123, Piso 5',
      },
    ];

    const buildings = await Promise.all(
      buildingData.map((b) =>
        prisma.building.upsert({
          where: { id: `demo-${b.alias}` },
          update: {},
          create: {
            id: `demo-${b.alias}`,
            name: b.name,
            alias: b.alias,
            address: b.address,
            tenantId: tenant.id,
            allocationMode: 'MANUAL',
          },
        }),
      ),
    );
    console.log(`  ✓ ${buildings.length} buildings created\n`);

    // ── 6. Units (4 per building) ──────────────────────────────────────
    console.log('→ Upserting units...');
    const unitsPerBuilding = 4;
    const allUnits: { id: string; code: string; buildingId: string }[] = [];

    for (const building of buildings) {
      const buildingUnits = [];
      for (let i = 1; i <= unitsPerBuilding; i++) {
        const floor = Math.ceil(i / 2);
        const letter = i % 2 === 1 ? 'A' : 'B';
        const code = `${floor}${letter}`;
        const unitId = `demo-unit-${building.alias}-${code}`;
        buildingUnits.push(
          prisma.unit.upsert({
            where: { id: unitId },
            update: {},
            create: {
              id: unitId,
              tenantId: tenant.id,
              buildingId: building.id,
              code,
              label: `Depto ${code}`,
              unitType: 'APARTAMENTO',
              occupancyStatus: 'OCCUPIED',
              isBillable: true,
            },
          }),
        );
      }
      const created = await Promise.all(buildingUnits);
      allUnits.push(...created);
    }
    console.log(`  ✓ ${allUnits.length} units created\n`);

    // ── 6b. Unit lookup map ─────────────────────────────────────────────
    const unitMap = new Map<string, (typeof allUnits)[0]>();
    for (const unit of allUnits) {
      const building = buildings.find((b) => b.id === unit.buildingId)!;
      const key = `${building.alias}-${unit.code}`;
      unitMap.set(key, unit);
    }

    // ── 7. TenantMembers + UnitOccupants ───────────────────────────────
    console.log('→ Upserting members & occupants...');
    const memberNames = [
      'María García',
      'Juan Pérez',
      'Laura Rodríguez',
      'Carlos López',
      'Ana Martínez',
      'Pedro Sánchez',
      'Sofía Fernández',
      'Diego Torres',
    ];

    const members = await Promise.all(
      memberNames.map((name, i) =>
        prisma.tenantMember.upsert({
          where: { id: `demo-member-${i + 1}` },
          update: {},
          create: {
            id: `demo-member-${i + 1}`,
            tenantId: tenant.id,
            name,
            email: `${name.toLowerCase().replace(/ /g, '.')}@demo.buildingos.app`,
            role: Role.RESIDENT,
            status: 'ACTIVE',
          },
        }),
      ),
    );

    // Assign 2-3 occupants per unit (cycling through members)
    const occupantPromises: Promise<any>[] = [];
    for (let u = 0; u < allUnits.length; u++) {
      const unit = allUnits[u];
      const memberOffset = (u * 2) % members.length;
      for (let m = 0; m < 2; m++) {
        const member = members[(memberOffset + m) % members.length];
        occupantPromises.push(
          prisma.unitOccupant.upsert({
            where: {
              unitId_memberId: { unitId: unit.id, memberId: member.id },
            },
            update: {},
            create: {
              id: `demo-occupant-${unit.id}-${member.id}`,
              tenantId: tenant.id,
              unitId: unit.id,
              memberId: member.id,
              role: m === 0 ? UnitOccupantRole.OWNER : UnitOccupantRole.RESIDENT,
              isPrimary: m === 0,
            },
          }),
        );
      }
    }
    await Promise.all(occupantPromises);
    console.log(`  ✓ ${members.length} members, ${occupantPromises.length} occupant links\n`);

    // ── 8. Tickets ─────────────────────────────────────────────────────
    console.log('→ Upserting tickets...');
    const ticketData = [
      { title: 'Fuga de agua en baño', description: 'Hay una pérdida en el caño del baño principal.', category: TicketCategory.MAINTENANCE, priority: TicketPriority.HIGH, status: TicketStatus.OPEN, buildingIdx: 0, unitIdx: 0 },
      { title: 'Ascensor descompuesto', description: 'El ascensor no funciona desde ayer.', category: TicketCategory.REPAIR, priority: TicketPriority.URGENT, status: TicketStatus.IN_PROGRESS, buildingIdx: 0, unitIdx: undefined },
      { title: 'Ruido en pasillo', description: 'Ruido constante en el pasillo del 3er piso durante la noche.', category: TicketCategory.COMPLAINT, priority: TicketPriority.MEDIUM, status: TicketStatus.OPEN, buildingIdx: 1, unitIdx: 1 },
      { title: 'Limpieza escaleras', description: 'Las escaleras del sector B necesitan limpieza.', category: TicketCategory.CLEANING, priority: TicketPriority.LOW, status: TicketStatus.RESOLVED, buildingIdx: 1, unitIdx: 3 },
      { title: 'Luz escalera quemada', description: 'La luz de la escalera del piso 2 está fundida.', category: TicketCategory.MAINTENANCE, priority: TicketPriority.MEDIUM, status: TicketStatus.OPEN, buildingIdx: 2, unitIdx: 2 },
    ];

    await Promise.all(
      ticketData.map((t, i) => {
        const building = buildings[t.buildingIdx];
        const unit = t.unitIdx !== undefined ? allUnits.find((u) => u.buildingId === building.id && u.code === `${Math.ceil((t.unitIdx! + 1) / 2)}${t.unitIdx! % 2 === 0 ? 'A' : 'B'}`) : null;
        return prisma.ticket.upsert({
          where: { id: `demo-ticket-${i + 1}` },
          update: {},
          create: {
            id: `demo-ticket-${i + 1}`,
            tenantId: tenant.id,
            buildingId: building.id,
            unitId: unit?.id ?? null,
            createdByUserId: user.id,
            title: t.title,
            description: t.description,
            category: t.category,
            priority: t.priority,
            status: t.status,
          },
        });
      }),
    );
    console.log(`  ✓ ${ticketData.length} tickets created\n`);

    // ── 9. Communications ──────────────────────────────────────────────
    console.log('→ Upserting communications...');
    const commData = [
      { title: 'Mantenimiento programado', body: 'Se realizarán tareas de mantenimiento en el sistema de agua caliente el día sábado de 9 a 13hs. Disculpe las molestias.', channel: CommunicationChannel.IN_APP, status: CommunicationStatus.SENT, buildingIdx: 0 },
      { title: 'Reunión de consorcio', body: 'Se informa que la próxima reunión de consorcio será el primer jueves del mes a las 19hs en el salón de usos múltiples.', channel: CommunicationChannel.IN_APP, status: CommunicationStatus.SENT, buildingIdx: undefined },
      { title: 'Corte de electricidad', body: 'El próximo martes habrá un corte de electricidad de 8 a 10hs por trabajos en el edificio. Tengan preparadas linternas.', channel: CommunicationChannel.EMAIL, status: CommunicationStatus.SENT, buildingIdx: 1 },
    ];

    const communications = await Promise.all(
      commData.map((c, i) =>
        prisma.communication.upsert({
          where: { id: `demo-comm-${i + 1}` },
          update: {},
          create: {
            id: `demo-comm-${i + 1}`,
            tenantId: tenant.id,
            buildingId: c.buildingIdx !== undefined ? buildings[c.buildingIdx].id : null,
            title: c.title,
            body: c.body,
            channel: c.channel,
            status: c.status,
            createdByMembershipId: membership.id,
            sentAt: c.status === CommunicationStatus.SENT ? new Date() : null,
          },
        }),
      ),
    );
    console.log(`  ✓ ${communications.length} communications created\n`);

    // ── 10. Communication Targets ──────────────────────────────────────
    console.log('→ Upserting communication targets...');
    await Promise.all(
      communications.map((comm, i) =>
        prisma.communicationTarget.upsert({
          where: { id: `demo-target-${i + 1}` },
          update: {},
          create: {
            id: `demo-target-${i + 1}`,
            tenantId: tenant.id,
            communicationId: comm.id,
            targetType: CommunicationTargetType.BUILDING,
            targetId: comm.buildingId ?? buildings[0].id,
          },
        }),
      ),
    );
    console.log(`  ✓ ${communications.length} communication targets created\n`);

    // ── 10b. Expense Ledger Categories (Rubros) ─────────────────────────
    console.log('→ Upserting expense categories (rubros)...');
    const categories = [
      { code: 'MANTENIMIENTO', name: 'Mantenimiento', description: 'Reparaciones y mantenimiento general', movementType: MovementType.EXPENSE, catalogScope: CatalogScope.BUILDING, sortOrder: 1 },
      { code: 'LIMPIEZA', name: 'Limpieza', description: 'Servicio de limpieza de áreas comunes', movementType: MovementType.EXPENSE, catalogScope: CatalogScope.BUILDING, sortOrder: 2 },
      { code: 'SEGURIDAD', name: 'Seguridad', description: 'Vigilancia y sistemas de seguridad', movementType: MovementType.EXPENSE, catalogScope: CatalogScope.BUILDING, sortOrder: 3 },
      { code: 'ASCENSORES', name: 'Ascensores', description: 'Mantenimiento de ascensores', movementType: MovementType.EXPENSE, catalogScope: CatalogScope.BUILDING, sortOrder: 4 },
      { code: 'ADMINISTRACION', name: 'Administración', description: 'Gastos administrativos y gestión', movementType: MovementType.EXPENSE, catalogScope: CatalogScope.CONDOMINIUM_COMMON, sortOrder: 5 },
      { code: 'AGUA', name: 'Agua', description: 'Servicio de agua potable', movementType: MovementType.EXPENSE, catalogScope: CatalogScope.BUILDING, sortOrder: 6 },
      { code: 'ELECTRICIDAD', name: 'Electricidad', description: 'Servicio eléctrico de áreas comunes', movementType: MovementType.EXPENSE, catalogScope: CatalogScope.BUILDING, sortOrder: 7 },
      { code: 'JARDINERIA', name: 'Jardinería', description: 'Mantenimiento de jardines y espacios verdes', movementType: MovementType.EXPENSE, catalogScope: CatalogScope.BUILDING, sortOrder: 8 },
    ];

    await Promise.all(
      categories.map((cat, i) =>
        prisma.expenseLedgerCategory.upsert({
          where: { id: `demo-cat-${cat.code}` },
          update: {},
          create: {
            id: `demo-cat-${cat.code}`,
            tenantId: tenant.id,
            code: cat.code,
            name: cat.name,
            description: cat.description,
            movementType: cat.movementType,
            catalogScope: cat.catalogScope,
            sortOrder: cat.sortOrder,
            isActive: true,
          },
        }),
      ),
    );
    console.log(`  ✓ ${categories.length} categories created\n`);

    // ── 11. Generate 24 Months of Charges ───────────────────────────────
    console.log('→ Generating 24 months of charges...');

    // Debt pattern: how many of the most recent months are unpaid
    const unitDebtMonths: Record<string, number> = {
      'A-1A': 0,   // always pays on time
      'A-1B': 2,   // 2 months behind
      'A-2A': 4,   // 4 months behind
      'A-2B': 0,   // always pays
      'B-1A': 0,   // always pays
      'B-1B': 2,   // 2 months behind
      'B-2A': 4,   // 4 months behind
      'B-2B': 6,   // 6 months behind
      'C-1A': 2,   // 2 months behind
      'C-1B': 4,   // 4 months behind
      'C-2A': 6,   // 6 months behind
      'C-2B': 0,   // always pays
    };

    // Base amounts per unit (in cents)
    const unitAmounts: Record<string, number> = {
      'A-1A': 35000, 'A-1B': 38000, 'A-2A': 32000, 'A-2B': 35000,
      'B-1A': 40000, 'B-1B': 42000, 'B-2A': 38000, 'B-2B': 40000,
      'C-1A': 30000, 'C-1B': 32000, 'C-2A': 28000, 'C-2B': 30000,
    };

    // Generate 24 month periods: 2024-07 → 2026-06
    const periods: string[] = [];
    for (let year = 2024; year <= 2026; year++) {
      const startMonth = year === 2024 ? 7 : 1;
      const endMonth = year === 2026 ? 6 : 12;
      for (let month = startMonth; month <= endMonth; month++) {
        periods.push(`${year}-${String(month).padStart(2, '0')}`);
      }
    }

    // Month names in Spanish for concept generation
    const monthNames = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
    ];

    const buildingAliases = ['A', 'B', 'C'];
    const unitCodes = ['1A', '1B', '2A', '2B'];

    // Build all charge upserts
    const chargeUpserts: Promise<any>[] = [];
    const chargeRecords: { id: string; buildingAlias: string; unitCode: string; period: string; amount: number; isPaid: boolean }[] = [];

    for (let periodIdx = 0; periodIdx < periods.length; periodIdx++) {
      const period = periods[periodIdx];
      const [pYear, pMonth] = period.split('-').map(Number);
      const monthLabel = `${monthNames[pMonth - 1]} ${pYear}`;

      // Due date: 10th of the following month
      // pMonth is 1-based from period string; JS Date month is 0-based,
      // so passing pMonth directly gives us the next month's 10th
      const dueDate = new Date(pYear, pMonth, 10);

      for (const buildingAlias of buildingAliases) {
        for (const unitCode of unitCodes) {
          const key = `${buildingAlias}-${unitCode}`;
          const unit = unitMap.get(key);
          if (!unit) continue;

          const baseAmount = unitAmounts[key] ?? 30000;
          const amount = baseAmount + Math.floor(Math.random() * 5000) - 2500;
          const chargeId = `demo-charge-${buildingAlias}-${unitCode}-${period}`;

          const debtMonths = unitDebtMonths[key] ?? 0;
          const isPaid = periodIdx < periods.length - debtMonths;

          chargeRecords.push({
            id: chargeId,
            buildingAlias,
            unitCode,
            period,
            amount,
            isPaid,
          });

          chargeUpserts.push(
            prisma.charge.upsert({
              where: { id: chargeId },
              update: {},
              create: {
                id: chargeId,
                tenantId: tenant.id,
                buildingId: unit.buildingId,
                unitId: unit.id,
                concept: `Expensas Comunes ${monthLabel}`,
                amount,
                currency: 'ARS',
                period,
                type: ChargeType.COMMON_EXPENSE,
                status: ChargeStatus.PENDING, // will be updated after allocations
                dueDate,
                createdByMembershipId: membership.id,
              },
            }),
          );
        }
      }
    }

    // Batch upserts in chunks of 20
    const batchSize = 20;
    for (let i = 0; i < chargeUpserts.length; i += batchSize) {
      const chunk = chargeUpserts.slice(i, i + batchSize);
      await Promise.all(chunk);
      if ((i + batchSize) % 120 === 0 || i + batchSize >= chargeUpserts.length) {
        console.log(`  … ${Math.min(i + batchSize, chargeUpserts.length)}/${chargeUpserts.length} charges upserted`);
      }
    }
    console.log(`  ✓ ${chargeRecords.length} charges created\n`);

    // ── 12. Create Payments ─────────────────────────────────────────────
    console.log('→ Generating payments...');

    const paymentUpserts: Promise<any>[] = [];
    const paymentRecords: { id: string; chargeId: string; buildingAlias: string; unitCode: string; period: string; amount: number }[] = [];

    for (const charge of chargeRecords) {
      if (!charge.isPaid) continue;

      const key = `${charge.buildingAlias}-${charge.unitCode}`;
      const unit = unitMap.get(key);
      if (!unit) continue;

      const [pYear, pMonth] = charge.period.split('-').map(Number);
      const paymentId = `demo-payment-${charge.buildingAlias}-${charge.unitCode}-${charge.period}`;

      // paidAt: 5 days after due date
      const paidAt = new Date(pYear, pMonth - 1 + 1, 15); // 10th of next month + 5 days = 15th

      // Reference: REF-{alias}-{code}-{YYYYMM} (no dash in period)
      const periodNoDash = charge.period.replace('-', '');
      const reference = `REF-${charge.buildingAlias}-${charge.unitCode}-${periodNoDash}`;

      paymentRecords.push({
        id: paymentId,
        chargeId: charge.id,
        buildingAlias: charge.buildingAlias,
        unitCode: charge.unitCode,
        period: charge.period,
        amount: charge.amount,
      });

      paymentUpserts.push(
        prisma.payment.upsert({
          where: { id: paymentId },
          update: {},
          create: {
            id: paymentId,
            tenantId: tenant.id,
            buildingId: unit.buildingId,
            unitId: unit.id,
            amount: charge.amount,
            currency: 'ARS',
            method: PaymentMethod.TRANSFER,
            status: PaymentStatus.APPROVED,
            paidAt,
            reference,
            createdByUserId: user.id,
          },
        }),
      );
    }

    for (let i = 0; i < paymentUpserts.length; i += batchSize) {
      const chunk = paymentUpserts.slice(i, i + batchSize);
      await Promise.all(chunk);
      if ((i + batchSize) % 120 === 0 || i + batchSize >= paymentUpserts.length) {
        console.log(`  … ${Math.min(i + batchSize, paymentUpserts.length)}/${paymentUpserts.length} payments upserted`);
      }
    }
    console.log(`  ✓ ${paymentRecords.length} payments created\n`);

    // ── 13. Create Payment Allocations ──────────────────────────────────
    console.log('→ Generating payment allocations...');

    const allocationUpserts: Promise<any>[] = [];

    for (const payment of paymentRecords) {
      const allocId = `demo-alloc-${payment.buildingAlias}-${payment.unitCode}-${payment.period}`;

      allocationUpserts.push(
        prisma.paymentAllocation.upsert({
          where: { id: allocId },
          update: {},
          create: {
            id: allocId,
            tenantId: tenant.id,
            paymentId: payment.id,
            chargeId: payment.chargeId,
            amount: payment.amount,
          },
        }),
      );
    }

    for (let i = 0; i < allocationUpserts.length; i += batchSize) {
      const chunk = allocationUpserts.slice(i, i + batchSize);
      await Promise.all(chunk);
      if ((i + batchSize) % 120 === 0 || i + batchSize >= allocationUpserts.length) {
        console.log(`  … ${Math.min(i + batchSize, allocationUpserts.length)}/${allocationUpserts.length} allocations upserted`);
      }
    }
    console.log(`  ✓ ${allocationUpserts.length} payment allocations created\n`);

    // ── 14. Update Charge Statuses ──────────────────────────────────────
    console.log('→ Updating charge statuses...');

    const paidChargeIds = new Set(paymentRecords.map((p) => p.chargeId));
    const statusUpdatePromises: Promise<any>[] = [];

    for (const charge of chargeRecords) {
      if (paidChargeIds.has(charge.id)) {
        statusUpdatePromises.push(
          prisma.charge.update({
            where: { id: charge.id },
            data: { status: ChargeStatus.PAID },
          }),
        );
      }
      // Unpaid charges remain PENDING (as initially created)
    }

    for (let i = 0; i < statusUpdatePromises.length; i += batchSize) {
      const chunk = statusUpdatePromises.slice(i, i + batchSize);
      await Promise.all(chunk);
    }
    console.log(`  ✓ ${statusUpdatePromises.length} charges marked as PAID\n`);

    // ── 15. Final Summary ──────────────────────────────────────────────
    const totalCharges = chargeRecords.length;
    const paidCount = paidChargeIds.size;
    const unpaidCount = totalCharges - paidCount;
    const unitsWithDebt = Object.values(unitDebtMonths).filter((d) => d > 0).length;

    console.log('='.repeat(60));
    console.log('✅ Demo tenant bootstrapped successfully!\n');
    console.log(`  Tenant:     ${tenant.name} (${tenant.id})`);
    console.log(`  User:       demo@buildingos.app`);
    console.log(`  Password:   ${DEMO_PASSWORD}`);
    console.log(`  Buildings:  ${buildings.length}`);
    console.log(`  Units:      ${allUnits.length}`);
    console.log(`  Charges:    ${totalCharges} (of which ${paidCount} paid, ${unpaidCount} pending)`);
    console.log(`  Payments:   ${paymentRecords.length}`);
    console.log(`  Debt:       ${unitsWithDebt} units with outstanding debt`);
    console.log(`  isDemo:     true (read-only guard active)`);
    console.log('='.repeat(60));
  } catch (error) {
    console.error('❌ Error bootstrapping demo tenant:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
