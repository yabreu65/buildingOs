import { PrismaClient } from '@prisma/client';
import { aliasFromIndex } from '../src/shared/utils/alias-generator';

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 Backfill: Asignando aliases a edificios existentes...\n');

  const tenants = await prisma.tenant.findMany({
    include: {
      buildings: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  let totalBuildings = 0;

  for (const tenant of tenants) {
    if (tenant.buildings.length === 0) {
      // Asegurar que el contador esté en 1 aunque no tenga edificios
      if (tenant.nextBuildingAliasIndex !== 1) {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: { nextBuildingAliasIndex: 1 },
        });
      }
      continue;
    }

    console.log(`→ Tenant: ${tenant.name} (${tenant.id})`);
    console.log(`  Edificios encontrados: ${tenant.buildings.length}`);

    let nextIndex = 1;

    for (const building of tenant.buildings) {
      // Saltar si ya tiene alias (idempotencia)
      if (building.alias) {
        console.log(`  ⏭️  ${building.name} ya tiene alias ${building.alias}`);
        nextIndex++;
        continue;
      }

      const alias = aliasFromIndex(nextIndex);

      await prisma.building.update({
        where: { id: building.id },
        data: { alias },
      });

      console.log(`  ✅ ${building.name} → alias ${alias}`);
      nextIndex++;
      totalBuildings++;
    }

    // Actualizar el contador del tenant
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { nextBuildingAliasIndex: nextIndex },
    });

    console.log(`  📊 nextBuildingAliasIndex = ${nextIndex}\n`);
  }

  console.log(`✅ Backfill completado. ${totalBuildings} edificios actualizados.`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
