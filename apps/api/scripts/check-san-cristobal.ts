import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { name: 'Residencia San Cristóbal' },
  });

  if (tenant) {
    console.log('✅ Tenant found:', tenant.id);
    
    const buildings = await prisma.building.findMany({
      where: { tenantId: tenant.id },
    });
    console.log('🏢 Buildings:', buildings.map(b => b.name).join(', '));
    
    const unitCount = await prisma.unit.count({
      where: { building: { tenantId: tenant.id } },
    });
    console.log('🏠 Units:', unitCount);
    
    const admin = await prisma.user.findUnique({
      where: { email: process.env.SAN_CRISTOBAL_ADMIN_EMAIL || 'admin@sancristobal.test' },
      include: { memberships: { include: { roles: true } } },
    });
    console.log('👤 Admin found:', admin ? 'YES' : 'NO');
    if (admin) {
      console.log('  Roles:', admin.memberships[0]?.roles.map(r => r.role).join(', '));
    }
  } else {
    console.log('❌ Tenant NOT FOUND - Need to run seed');
  }
  
  await prisma.$disconnect();
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
