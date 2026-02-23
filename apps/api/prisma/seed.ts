import { PrismaClient, Role, TenantType, BillingPlanId, DocumentCategory, DocumentVisibility, QuoteStatus, WorkOrderStatus, ChargeStatus, PaymentStatus, PaymentMethod, ChargeType } from "@prisma/client";
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
      update: {
        aiBudgetCents: 0,
        aiCallsMonthlyLimit: 0,
        aiAllowBigModel: false,
        canUseAI: false,
      },
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
        supportLevel: "COMMUNITY",
      },
    }),
    prisma.billingPlan.upsert({
      where: { planId: BillingPlanId.BASIC },
      update: {
        canUseAI: true,
        aiBudgetCents: 200,
        aiCallsMonthlyLimit: 100,
        aiAllowBigModel: false,
      },
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
        canUseAI: true,
        aiBudgetCents: 200,
        aiCallsMonthlyLimit: 100,
        aiAllowBigModel: false,
        supportLevel: "EMAIL",
      },
    }),
    prisma.billingPlan.upsert({
      where: { planId: BillingPlanId.PRO },
      update: {
        aiBudgetCents: 800,
        aiCallsMonthlyLimit: 600,
        aiAllowBigModel: true,
      },
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
        canUseAI: true,
        aiBudgetCents: 800,
        aiCallsMonthlyLimit: 600,
        aiAllowBigModel: true,
        supportLevel: "PRIORITY",
      },
    }),
    prisma.billingPlan.upsert({
      where: { planId: BillingPlanId.ENTERPRISE },
      update: {
        aiBudgetCents: 10000,
        aiCallsMonthlyLimit: 9999,
        aiAllowBigModel: true,
      },
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
        canUseAI: true,
        aiBudgetCents: 10000,
        aiCallsMonthlyLimit: 9999,
        aiAllowBigModel: true,
        supportLevel: "PRIORITY",
      },
    }),
  ]);
  console.log(`✅ Created ${plans.length} billing plans`);

  // ============================================================================
  // AI TEMPLATES (MVP)
  // Idempotent upsert by unique key. Never deletes existing templates.
  // ============================================================================
  const templateSeeds = [
    {
      key: "INBOX_PRIORITIZE",
      name: "Priorizar bandeja",
      description: "Resume y prioriza pendientes de inbox con foco operativo.",
      category: "inbox",
      promptSystem:
        "Eres un asistente operativo para administracion de edificios. Prioriza por urgencia, impacto y vencimientos.",
      promptUser:
        "Analiza los items de inbox y devuelve top prioridades con acciones sugeridas. Contexto: {{context}}",
      maxOutputTokens: 280,
      requiredPermissions: ["tickets.read", "payments.read", "communications.read"],
    },
    {
      key: "TICKET_REPLY_DRAFT",
      name: "Borrador respuesta ticket",
      description: "Genera respuesta profesional para tickets de mantenimiento.",
      category: "tickets",
      promptSystem:
        "Redacta respuestas claras, empaticas y accionables para tickets de soporte y mantenimiento.",
      promptUser:
        "Escribe un borrador de respuesta para el ticket. Titulo: {{ticket_title}}. Descripcion: {{ticket_description}}. Ultimo comentario: {{last_comment}}.",
      maxOutputTokens: 260,
      requiredPermissions: ["tickets.read", "tickets.write"],
    },
    {
      key: "COMMUNICATION_DRAFT_GENERAL",
      name: "Comunicado general",
      description: "Crea borrador de comunicado general para residentes.",
      category: "communications",
      promptSystem:
        "Redacta comunicados claros, breves y orientados a accion para residentes.",
      promptUser:
        "Genera un comunicado general sobre: {{topic}}. Audiencia: {{audience}}. Tono: {{tone}}.",
      maxOutputTokens: 300,
      requiredPermissions: ["communications.write"],
    },
    {
      key: "COMMUNICATION_PAYMENT_REMINDER",
      name: "Recordatorio de pago",
      description: "Genera recordatorio de pago con tono cordial y fecha limite.",
      category: "finance",
      promptSystem:
        "Redacta recordatorios de pago claros y respetuosos, incluyendo fecha limite y canales de pago.",
      promptUser:
        "Crea un recordatorio de pago para la unidad {{unit_code}}. Monto: {{amount}}. Vencimiento: {{due_date}}. Contexto adicional: {{context}}.",
      maxOutputTokens: 240,
      requiredPermissions: ["payments.read", "communications.write"],
    },
    {
      key: "FINANCE_EXPLAIN_BALANCE",
      name: "Explicar balance",
      description: "Explica estado de cuenta y variaciones para facilitar cobranza.",
      category: "finance",
      promptSystem:
        "Explica balances financieros en lenguaje simple, destacando deudas, pagos y proximos vencimientos.",
      promptUser:
        "Explica el balance de la unidad {{unit_code}} con estos datos: {{balance_data}}. Incluye recomendaciones practicas.",
      maxOutputTokens: 320,
      requiredPermissions: ["payments.read", "reports.read"],
    },
  ];

  await Promise.all(
    templateSeeds.map((template) =>
      prisma.aiTemplate.upsert({
        where: { key: template.key },
        update: {
          name: template.name,
          description: template.description,
          scopeType: "TENANT",
          requiredPermissions: template.requiredPermissions,
          enabledByDefault: true,
          promptSystem: template.promptSystem,
          promptUser: template.promptUser,
          maxOutputTokens: template.maxOutputTokens,
          category: template.category,
          isActive: true,
        },
        create: {
          tenantId: null, // global template
          key: template.key,
          name: template.name,
          description: template.description,
          scopeType: "TENANT",
          requiredPermissions: template.requiredPermissions,
          enabledByDefault: true,
          promptSystem: template.promptSystem,
          promptUser: template.promptUser,
          maxOutputTokens: template.maxOutputTokens,
          category: template.category,
          isActive: true,
        },
      }),
    ),
  );
  console.log(`✅ Upserted ${templateSeeds.length} AI templates`);

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

    // Create membership role (scoped roles don't have unique constraint anymore)
    // So we try to create, and ignore if it already exists
    try {
      await prisma.membershipRole.create({
        data: {
          membershipId: membership.id,
          role: params.role,
          scopeType: 'TENANT',
        },
      });
    } catch (e) {
      // Ignore if it already exists
    }

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

  // NOTE: Tenant B (tenantBuilding) has FREE plan with maxUsers=2
  // Keep only admin + resident to stay within limit
  // operatorUser removed to respect FREE plan limits
  // await upsertMembershipWithRole({
  //   tenantId: tenantBuilding.id,
  //   userId: operatorUser.id,
  //   role: Role.OPERATOR,
  // });

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
  // Create SUPER_ADMIN role
  try {
    await prisma.membershipRole.create({
      data: {
        membershipId: superAdminMembership.id,
        role: Role.SUPER_ADMIN,
        scopeType: 'TENANT',
      },
    });
  } catch (e) {
    // Ignore if it already exists
  }

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

  // 4) Buildings for ADMINISTRADORA tenant (2 buildings)
  const building1Admin = await prisma.building.upsert({
    where: { tenantId_name: { tenantId: tenantAdmin.id, name: "Building A - Downtown" } },
    update: {},
    create: {
      tenantId: tenantAdmin.id,
      name: "Building A - Downtown",
      address: "456 Park Ave, Downtown District",
    },
  });

  const building2Admin = await prisma.building.upsert({
    where: { tenantId_name: { tenantId: tenantAdmin.id, name: "Building B - Uptown" } },
    update: {},
    create: {
      tenantId: tenantAdmin.id,
      name: "Building B - Uptown",
      address: "789 Oak Boulevard, Uptown Area",
    },
  });

  // 5) Units for ADMINISTRADORA buildings (3 units each)
  // Building A units
  const unitA1 = await prisma.unit.upsert({
    where: { buildingId_code: { buildingId: building1Admin.id, code: "A-101" } },
    update: {},
    create: {
      buildingId: building1Admin.id,
      code: "A-101",
      label: "Apt A-101",
      unitType: "APARTMENT",
      occupancyStatus: "OCCUPIED",
    },
  });

  const unitA2 = await prisma.unit.upsert({
    where: { buildingId_code: { buildingId: building1Admin.id, code: "A-102" } },
    update: {},
    create: {
      buildingId: building1Admin.id,
      code: "A-102",
      label: "Apt A-102",
      unitType: "APARTMENT",
      occupancyStatus: "OCCUPIED",
    },
  });

  const unitA3 = await prisma.unit.upsert({
    where: { buildingId_code: { buildingId: building1Admin.id, code: "A-103" } },
    update: {},
    create: {
      buildingId: building1Admin.id,
      code: "A-103",
      label: "Apt A-103",
      unitType: "APARTMENT",
      occupancyStatus: "VACANT",
    },
  });

  // Building B units
  const unitB1 = await prisma.unit.upsert({
    where: { buildingId_code: { buildingId: building2Admin.id, code: "B-201" } },
    update: {},
    create: {
      buildingId: building2Admin.id,
      code: "B-201",
      label: "Apt B-201",
      unitType: "APARTMENT",
      occupancyStatus: "OCCUPIED",
    },
  });

  const unitB2 = await prisma.unit.upsert({
    where: { buildingId_code: { buildingId: building2Admin.id, code: "B-202" } },
    update: {},
    create: {
      buildingId: building2Admin.id,
      code: "B-202",
      label: "Apt B-202",
      unitType: "APARTMENT",
      occupancyStatus: "VACANT",
    },
  });

  const unitB3 = await prisma.unit.upsert({
    where: { buildingId_code: { buildingId: building2Admin.id, code: "B-203" } },
    update: {},
    create: {
      buildingId: building2Admin.id,
      code: "B-203",
      label: "Apt B-203",
      unitType: "APARTMENT",
      occupancyStatus: "OCCUPIED",
    },
  });

  // 6) Buildings for EDIFICIO_AUTOGESTION tenant (1 building)
  const building = await prisma.building.upsert({
    where: { tenantId_name: { tenantId: tenantBuilding.id, name: "Demo Building - Self Managed" } },
    update: {},
    create: {
      tenantId: tenantBuilding.id,
      name: "Demo Building - Self Managed",
      address: "123 Main St, Apartment Complex",
    },
  });

  // 7) Units for EDIFICIO_AUTOGESTION building (6 units)
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
      occupancyStatus: "OCCUPIED",
    },
  });

  const unit3 = await prisma.unit.upsert({
    where: { buildingId_code: { buildingId: building.id, code: "103" } },
    update: {},
    create: {
      buildingId: building.id,
      code: "103",
      label: "Apt 103",
      unitType: "APARTMENT",
      occupancyStatus: "VACANT",
    },
  });

  const unit4 = await prisma.unit.upsert({
    where: { buildingId_code: { buildingId: building.id, code: "201" } },
    update: {},
    create: {
      buildingId: building.id,
      code: "201",
      label: "Apt 201",
      unitType: "APARTMENT",
      occupancyStatus: "OCCUPIED",
    },
  });

  const unit5 = await prisma.unit.upsert({
    where: { buildingId_code: { buildingId: building.id, code: "202" } },
    update: {},
    create: {
      buildingId: building.id,
      code: "202",
      label: "Apt 202",
      unitType: "APARTMENT",
      occupancyStatus: "OCCUPIED",
    },
  });

  const unit6 = await prisma.unit.upsert({
    where: { buildingId_code: { buildingId: building.id, code: "203" } },
    update: {},
    create: {
      buildingId: building.id,
      code: "203",
      label: "Apt 203",
      unitType: "APARTMENT",
      occupancyStatus: "VACANT",
    },
  });

  // 8) Unit Occupants for EDIFICIO_AUTOGESTION building
  // Assign residents to occupied units
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

  await prisma.unitOccupant.upsert({
    where: {
      unitId_userId_role: {
        unitId: unit4.id,
        userId: operatorUser.id,
        role: "OWNER",
      },
    },
    update: {},
    create: {
      unitId: unit4.id,
      userId: operatorUser.id,
      role: "OWNER",
    },
  });

  await prisma.unitOccupant.upsert({
    where: {
      unitId_userId_role: {
        unitId: unit5.id,
        userId: residentUser.id,
        role: "RESIDENT",
      },
    },
    update: {},
    create: {
      unitId: unit5.id,
      userId: residentUser.id,
      role: "RESIDENT",
    },
  });

  // ============================================================================
  // TICKETS (MVP - Maintenance requests)
  // ============================================================================
  // Get the operator membership for assignment
  const operatorMembership = await prisma.membership.findFirst({
    where: {
      userId: operatorUser.id,
      tenantId: tenantBuilding.id,
    },
  });

  // Create 1 ticket per building
  const ticket1 = await prisma.ticket.upsert({
    where: { id: "ticket-demo-001" },
    update: {},
    create: {
      id: "ticket-demo-001",
      tenantId: tenantBuilding.id,
      buildingId: building.id,
      unitId: unit1.id,
      createdByUserId: residentUser.id,
      assignedToMembershipId: operatorMembership?.id || undefined,
      title: "Leaky faucet in bathroom",
      description: "The hot water tap is dripping constantly. Please fix at earliest convenience.",
      category: "MAINTENANCE",
      priority: "MEDIUM",
      status: "OPEN",
    },
  });

  // Create 1 comment on the ticket
  await prisma.ticketComment.upsert({
    where: { id: "ticket-comment-demo-001" },
    update: {},
    create: {
      id: "ticket-comment-demo-001",
      tenantId: tenantBuilding.id,
      ticketId: ticket1.id,
      authorUserId: operatorUser.id,
      body: "Acknowledged. Will schedule a visit next week. Please ensure someone is home between 9 AM - 5 PM.",
    },
  });

  // ============================================================================
  // DOCUMENTS & FILES (MVP - Building rules, unit-specific docs, etc.)
  // ============================================================================
  // Get the admin membership for document creation audit trail
  const adminMembership = await prisma.membership.findFirst({
    where: {
      userId: adminUser.id,
      tenantId: tenantBuilding.id,
    },
  });

  // Building-scoped document (e.g., building rules)
  const buildingRulesFile = await prisma.file.upsert({
    where: { id: "file-building-rules-demo" },
    update: {},
    create: {
      id: "file-building-rules-demo",
      tenantId: tenantBuilding.id,
      bucket: "documents",
      objectKey: `tenant-${tenantBuilding.id}/building-${building.id}/rules.pdf`,
      originalName: "Reglamento_Edificio_Demo.pdf",
      mimeType: "application/pdf",
      size: 245632, // ~240KB
      checksum: "sha256:abc123def456...",
      createdByMembershipId: adminMembership?.id || undefined,
    },
  });

  const buildingRulesDoc = await prisma.document.upsert({
    where: { id: "doc-building-rules-demo" },
    update: {},
    create: {
      id: "doc-building-rules-demo",
      tenantId: tenantBuilding.id,
      fileId: buildingRulesFile.id,
      title: "Reglamento de Convivencia - Edificio Demo",
      category: DocumentCategory.RULES,
      visibility: DocumentVisibility.RESIDENTS, // Visible to all residents
      buildingId: building.id,
      unitId: undefined, // Building-scoped, not unit-scoped
      createdByMembershipId: adminMembership?.id || undefined,
    },
  });

  // Unit-scoped document (e.g., unit-specific instruction)
  const unitDocFile = await prisma.file.upsert({
    where: { id: "file-unit-doc-demo" },
    update: {},
    create: {
      id: "file-unit-doc-demo",
      tenantId: tenantBuilding.id,
      bucket: "documents",
      objectKey: `tenant-${tenantBuilding.id}/unit-${unit1.id}/maintenance-guide.pdf`,
      originalName: "Guia_Mantenimiento_Unidad.pdf",
      mimeType: "application/pdf",
      size: 102400, // ~100KB
      checksum: "sha256:xyz789uvw012...",
      createdByMembershipId: adminMembership?.id || undefined,
    },
  });

  const unitDoc = await prisma.document.upsert({
    where: { id: "doc-unit-demo" },
    update: {},
    create: {
      id: "doc-unit-demo",
      tenantId: tenantBuilding.id,
      fileId: unitDocFile.id,
      title: `Guía de Mantenimiento - ${unit1.label}`,
      category: DocumentCategory.OTHER,
      visibility: DocumentVisibility.TENANT_ADMINS, // Only admins
      buildingId: building.id,
      unitId: unit1.id, // Unit-scoped
      createdByMembershipId: adminMembership?.id || undefined,
    },
  });

  // ============================================================================
  // VENDORS & OPERATIONS (Proveedores, Presupuestos, Órdenes de Trabajo)
  // ============================================================================

  // Create a vendor (plomero)
  const vendor = await prisma.vendor.upsert({
    where: { id: "vendor-plomeria-express" },
    update: {},
    create: {
      id: "vendor-plomeria-express",
      tenantId: tenantBuilding.id,
      name: "Plomería Express",
      taxId: "20-12345678-9", // Argentina CUIT format
      email: "contacto@plomeria-express.com.ar",
      phone: "+54 9 11 2345-6789",
      notes: "Proveedor de servicios de plomería con 10 años de experiencia",
    },
  });

  // Create a vendor assignment (Plomería Express assigned to Demo Building)
  const vendorAssignment = await prisma.vendorAssignment.upsert({
    where: {
      vendorId_buildingId_serviceType: {
        vendorId: vendor.id,
        buildingId: building.id,
        serviceType: "PLUMBING",
      },
    },
    update: {},
    create: {
      tenantId: tenantBuilding.id,
      vendorId: vendor.id,
      buildingId: building.id,
      serviceType: "PLUMBING",
    },
  });

  // Create a quote associated with ticket1
  const quote = await prisma.quote.upsert({
    where: { id: "quote-ticket-demo" },
    update: {},
    create: {
      id: "quote-ticket-demo",
      tenantId: tenantBuilding.id,
      buildingId: building.id,
      vendorId: vendor.id,
      ticketId: ticket1.id,
      amount: 50000, // $500.00 ARS
      currency: "ARS",
      status: "RECEIVED",
      notes: "Presupuesto para reparación de cañería en baño principal. Incluye mano de obra y materiales.",
    },
  });

  // Create a work order associated with ticket1
  const workOrder = await prisma.workOrder.upsert({
    where: { id: "workorder-ticket-demo" },
    update: {},
    create: {
      id: "workorder-ticket-demo",
      tenantId: tenantBuilding.id,
      buildingId: building.id,
      ticketId: ticket1.id,
      vendorId: vendor.id,
      assignedToMembershipId: operatorMembership?.id || undefined,
      status: "OPEN",
      description: "Reparación de cañería rota en baño. Requiere retiro de piso.",
      scheduledFor: new Date(new Date().getTime() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
    },
  });

  // ============================================================================
  // FINANZAS: Charges, Payments, and Allocations
  // ============================================================================
  const currentPeriod = "2026-02"; // February 2026
  const previousPeriod = "2026-01"; // January 2026

  // Charge 1: Common expense for unit1 in February
  const charge1 = await prisma.charge.upsert({
    where: { id: "charge-unit1-feb-2026" },
    update: {},
    create: {
      id: "charge-unit1-feb-2026",
      tenantId: tenantBuilding.id,
      buildingId: building.id,
      unitId: unit1.id,
      period: currentPeriod,
      type: "COMMON_EXPENSE",
      concept: "Expensas Comunes Febrero 2026",
      amount: 50000, // $500.00 ARS
      currency: "ARS",
      dueDate: new Date(2026, 2, 15), // March 15, 2026
      status: "PARTIAL",
      createdByMembershipId: operatorMembership?.id || undefined,
    },
  });

  // Charge 2: Common expense for unit1 in January (previous month, should be PAID)
  const charge2 = await prisma.charge.upsert({
    where: { id: "charge-unit1-jan-2026" },
    update: {},
    create: {
      id: "charge-unit1-jan-2026",
      tenantId: tenantBuilding.id,
      buildingId: building.id,
      unitId: unit1.id,
      period: previousPeriod,
      type: "COMMON_EXPENSE",
      concept: "Expensas Comunes Enero 2026",
      amount: 45000, // $450.00 ARS
      currency: "ARS",
      dueDate: new Date(2026, 1, 15), // February 15, 2026
      status: "PAID",
      createdByMembershipId: operatorMembership?.id || undefined,
    },
  });

  // Payment: Resident submitted partial payment for February expense
  const payment = await prisma.payment.upsert({
    where: { id: "payment-unit1-submitted" },
    update: {},
    create: {
      id: "payment-unit1-submitted",
      tenantId: tenantBuilding.id,
      buildingId: building.id,
      unitId: unit1.id,
      amount: 30000, // $300.00 ARS (partial payment)
      currency: "ARS",
      method: "TRANSFER",
      status: "SUBMITTED",
      paidAt: new Date(), // Today
      reference: "CBU-1234567890", // Payment reference
      proofFileId: undefined, // Optional proof file
      createdByUserId: residentUser.id,
      reviewedByMembershipId: undefined, // Not yet reviewed
    },
  });

  // PaymentAllocation: Allocate the payment to the February charge
  const allocation = await prisma.paymentAllocation.upsert({
    where: { id: "allocation-payment-to-charge-feb" },
    update: {},
    create: {
      id: "allocation-payment-to-charge-feb",
      tenantId: tenantBuilding.id,
      paymentId: payment.id,
      chargeId: charge1.id,
      amount: 30000, // Full payment allocated to February charge
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

  TICKETS:
  - Ticket: "${ticket1.title}" (ID: ${ticket1.id})
    • Status: ${ticket1.status}, Priority: ${ticket1.priority}
    • Created by: ${residentUser.name}
    • Assigned to: ${operatorUser.name}
    • Unit: ${unit1.label}
    • Comment: Operator acknowledged the issue

  DOCUMENTS & FILES:
  - Building Document: "${buildingRulesDoc.title}"
    • Category: ${buildingRulesDoc.category}
    • Visibility: ${buildingRulesDoc.visibility} (visible to residents)
    • Scope: Building-wide (${building.name})
    • File: ${buildingRulesFile.originalName} (${buildingRulesFile.size} bytes)
    • MinIO path: ${buildingRulesFile.objectKey}

  - Unit Document: "${unitDoc.title}"
    • Category: ${unitDoc.category}
    • Visibility: ${unitDoc.visibility} (admin only)
    • Scope: Unit ${unit1.label}
    • File: ${unitDocFile.originalName} (${unitDocFile.size} bytes)
    • MinIO path: ${unitDocFile.objectKey}

  VENDORS & OPERATIONS:
  - Vendor: "${vendor.name}"
    • Tax ID: ${vendor.taxId}
    • Email: ${vendor.email}
    • Phone: ${vendor.phone}
    • Notes: ${vendor.notes}

  - Vendor Assignment: ${vendor.name} → ${building.name}
    • Service Type: PLUMBING
    • Assignment ID: ${vendorAssignment.id}

  - Quote: Associated with Ticket "${ticket1.title}"
    • Vendor: ${vendor.name}
    • Amount: $${(quote.amount / 100).toFixed(2)} ${quote.currency}
    • Status: ${quote.status}
    • Notes: ${quote.notes}
    • Quote ID: ${quote.id}

  - Work Order: Associated with Ticket "${ticket1.title}"
    • Vendor: ${vendor.name}
    • Assigned to: Operator Demo
    • Status: ${workOrder.status}
    • Scheduled for: ${workOrder.scheduledFor?.toLocaleDateString()}
    • Description: ${workOrder.description}
    • Work Order ID: ${workOrder.id}

  FINANZAS (Charges, Payments, Allocations):
  - Charge 1 (Current): "${charge1.concept}"
    • Unit: ${unit1.label}
    • Period: ${charge1.period}
    • Amount: $${(charge1.amount / 100).toFixed(2)} ${charge1.currency}
    • Due Date: ${charge1.dueDate.toLocaleDateString()}
    • Status: ${charge1.status} (partial payment received)
    • Charge ID: ${charge1.id}

  - Charge 2 (Previous): "${charge2.concept}"
    • Unit: ${unit1.label}
    • Period: ${charge2.period}
    • Amount: $${(charge2.amount / 100).toFixed(2)} ${charge2.currency}
    • Due Date: ${charge2.dueDate.toLocaleDateString()}
    • Status: ${charge2.status} (fully paid)
    • Charge ID: ${charge2.id}

  - Payment: SUBMITTED by ${residentUser.name}
    • Amount: $${(payment.amount / 100).toFixed(2)} ${payment.currency}
    • Method: ${payment.method}
    • Status: ${payment.status} (awaiting admin review)
    • Reference: ${payment.reference}
    • Payment ID: ${payment.id}

  - PaymentAllocation: Links payment to charge
    • Payment: $${(allocation.amount / 100).toFixed(2)} → Charge "${charge1.concept}"
    • Status: Partial (charge balance: $${((charge1.amount - allocation.amount) / 100).toFixed(2)} ARS remaining)
    • Allocation ID: ${allocation.id}
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
