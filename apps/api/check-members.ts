import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkMembers() {
  // Get all tenants
  const tenants = await prisma.tenant.findMany();
  console.log(`\n📊 Total tenants: ${tenants.length}\n`);

  for (const tenant of tenants) {
    console.log(`\n🏢 Tenant: ${tenant.name} (${tenant.id})`);
    
    // Get all memberships for this tenant
    const memberships = await prisma.membership.findMany({
      where: { tenantId: tenant.id },
      include: {
        user: true,
        roles: true,
      },
    });

    console.log(`   📝 Memberships: ${memberships.length}`);
    
    for (const m of memberships) {
      const roles = m.roles.map(r => r.role).join(', ');
      console.log(`   • ${m.user.name} (${m.user.email}): ${roles}`);
    }

    // Show assignable residents
    const adminRoles = ['TENANT_ADMIN', 'TENANT_OWNER', 'SUPER_ADMIN'];
    const assignable = memberships.filter(m => 
      !m.roles.some(r => adminRoles.includes(r.role))
    );
    console.log(`   ✅ Assignable (non-admin): ${assignable.length}`);
  }

  process.exit(0);
}

checkMembers().catch(e => {
  console.error(e);
  process.exit(1);
});
