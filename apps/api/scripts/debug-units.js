const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function debug() {
  const tenantId = process.env.TENANT_ID;
  if (!tenantId) throw new Error('TENANT_ID is required');
  
  // Buscar edificio Torre A
  const building = await prisma.building.findFirst({
    where: { tenantId, name: 'Torre A' },
    select: { id: true, name: true }
  });
  console.log('Building:', building);
  
  // Buscar unidades del edificio
  const units = await prisma.unit.findMany({
    where: { buildingId: building.id },
    select: { id: true, code: true, label: true },
    orderBy: { code: 'asc' },
    take: 20
  });
  
  console.log('\nFirst 20 units in Torre A:');
  units.forEach(u => console.log(`  ${u.code} - ${u.label}`));
  
  // Buscar específicamente 0101 y 101
  const unit0101 = await prisma.unit.findFirst({
    where: { buildingId: building.id, code: '0101' },
    select: { id: true, code: true, label: true }
  });
  
  const unit101 = await prisma.unit.findFirst({
    where: { buildingId: building.id, code: '101' },
    select: { id: true, code: true, label: true }
  });
  
  console.log('\nUnit 0101:', unit0101);
  console.log('Unit 101:', unit101);
  
  // Verificar si 0101 existe realmente
  const count = await prisma.unit.count({
    where: { buildingId: building.id }
  });
  console.log(`\nTotal units in Torre A: ${count}`);
  
  await prisma.$disconnect();
}

debug().catch(console.error);
