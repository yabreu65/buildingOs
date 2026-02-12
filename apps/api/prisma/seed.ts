import { PrismaClient, Role, TenantType } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

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
    userId: residentUser.id,
    role: Role.RESIDENT,
  });

  console.log("Seed finished.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
