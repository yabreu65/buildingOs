import { PrismaClient } from "@prisma/client";

import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // 1. Create Tenants
  const tenantAdmin = await prisma.tenant.create({
    data: {
      name: 'Admin Demo',
      type: "ADMINISTRADORA",
    },
  });

  const tenantBuilding = await prisma.tenant.create({
    data: {
      name: 'Edificio Demo',
      type: "EDIFICIO_AUTOGESTION",
    },
  });

  // 2. Create Users
  const adminPassword = await bcrypt.hash('Admin123!', 10);
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@demo.com' },
    update: {},
    create: {
      email: 'admin@demo.com',
      name: 'Admin Demo',
      passwordHash: adminPassword,
    },
  });

  const residentPassword = await bcrypt.hash('Resident123!', 10);
  const residentUser = await prisma.user.upsert({
    where: { email: 'resident@demo.com' },
    update: {},
    create: {
      email: 'resident@demo.com',
      name: 'Resident Demo',
      passwordHash: residentPassword,
    },
  });

  // 3. Create Memberships & Roles
  // Admin User -> Tenant Admin (TENANT_ADMIN)
  const m1 = await prisma.membership.create({
    data: {
      tenantId: tenantAdmin.id,
      userId: adminUser.id,
    },
  });
  await prisma.membershipRole.create({
    data: {
      membershipId: m1.id,
      role: "TENANT_ADMIN",
    },
  });

  // Admin User -> Tenant Building (TENANT_ADMIN)
  const m2 = await prisma.membership.create({
    data: {
      tenantId: tenantBuilding.id,
      userId: adminUser.id,
    },
  });
  await prisma.membershipRole.create({
    data: {
      membershipId: m2.id,
      role: "TENANT_ADMIN",
    },
  });

  // Resident User -> Tenant Building (RESIDENT)
  const m3 = await prisma.membership.create({
    data: {
      tenantId: tenantBuilding.id,
      userId: residentUser.id,
    },
  });
  await prisma.membershipRole.create({
    data: {
      membershipId: m3.id,
      role: "RESIDENT",
    },
  });

  console.log('Seed finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
