import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Normaliza códigos de unidad:
 * - Apartamentos: A-0108 → 0108, B-0201 → 0201
 * - Estacionamientos: A-P001 → P001, B-P097 → P097
 */
async function main() {
  console.log('🔧 Normalizando códigos de unidades...\n');

  const units = await prisma.unit.findMany({
    where: {
      OR: [
        { code: { startsWith: 'A-' } },
        { code: { startsWith: 'B-' } },
      ],
    },
    select: { id: true, code: true, unitType: true, buildingId: true },
  });

  console.log(`Found ${units.length} units with A- or B- prefix\n`);

  let updatedApartments = 0;
  let updatedParkings = 0;
  let skipped = 0;

  for (const unit of units) {
    let newCode: string;

    if (unit.unitType === 'ESTACIONAMIENTO') {
      // A-P001 → P001, B-P097 → P097
      newCode = unit.code.replace(/^[AB]-P/, 'P');
    } else {
      // A-0108 → 0108, B-0201 → 0201
      newCode = unit.code.replace(/^[AB]-/, '');
    }

    if (newCode === unit.code) {
      console.log(`  ⏭️  Skipped ${unit.code} (no change)`);
      skipped++;
      continue;
    }

    try {
      await prisma.unit.update({
        where: { id: unit.id },
        data: { code: newCode },
      });

      if (unit.unitType === 'ESTACIONAMIENTO') {
        updatedParkings++;
      } else {
        updatedApartments++;
      }

      console.log(`  ✅ ${unit.code} → ${newCode}`);
    } catch (error) {
      console.log(`  ❌ Failed to update ${unit.code}: ${error}`);
      skipped++;
    }
  }

  console.log(`\n✅ Normalización completada.`);
  console.log(`   Apartamentos: ${updatedApartments} actualizados`);
  console.log(`   Estacionamientos: ${updatedParkings} actualizados`);
  console.log(`   Saltados: ${skipped}`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
