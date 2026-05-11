import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Migra códigos de unidad de 3 dígitos a 4 dígitos.
 * 
 * Formato 3 dígitos: {floor:2}{unit:1} → 011, 012, 121
 * Formato 4 dígitos: {floor:2}{unit:2} → 0101, 0102, 1201
 */
function convertThreeToFourDigits(code: string): string {
  if (code.length !== 3) return code; // Solo convertir códigos de 3 dígitos
  
  const floor = code.substring(0, 2);
  const unit = code.substring(2, 3);
  
  return `${floor}${unit.padStart(2, '0')}`;
}

async function main() {
  console.log('🔧 Migrando códigos de unidad de 3 a 4 dígitos...\n');

  const units = await prisma.unit.findMany({
    where: {
      code: {
        // Códigos de exactamente 3 dígitos
        gte: '000',
        lte: '999',
      },
    },
    select: { id: true, code: true, buildingId: true },
  });

  console.log(`Found ${units.length} units with 3-digit codes`);

  let updated = 0;
  let skipped = 0;

  for (const unit of units) {
    // Verificar que sea exactamente 3 dígitos
    if (!/^\d{3}$/.test(unit.code)) {
      skipped++;
      continue;
    }

    const newCode = convertThreeToFourDigits(unit.code);
    
    try {
      await prisma.unit.update({
        where: { id: unit.id },
        data: { code: newCode },
      });
      console.log(`  ✅ ${unit.code} → ${newCode}`);
      updated++;
    } catch (error) {
      console.log(`  ❌ Failed to update ${unit.code}: ${error}`);
      skipped++;
    }
  }

  console.log(`\n✅ Migration complete. ${updated} updated, ${skipped} skipped.`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
