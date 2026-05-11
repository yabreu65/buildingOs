import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Asocia estacionamientos con apartamentos basado en índice numérico.
 * 
 * Regla: P001 → 0101, P002 → 0102, ..., P096 → 1208
 * (96 apartamentos = 12 pisos × 8 deptos)
 */
async function main() {
  console.log('🔗 Asociando estacionamientos con apartamentos...\n');

  const tenants = await prisma.tenant.findMany({
    include: {
      buildings: {
        include: {
          units: {
            where: {
              unitType: { in: ['APARTAMENTO', 'ESTACIONAMIENTO'] },
            },
            select: { id: true, code: true, unitType: true },
          },
        },
      },
    },
  });

  let totalAssociations = 0;

  for (const tenant of tenants) {
    for (const building of tenant.buildings) {
      const apartments = building.units
        .filter((u) => u.unitType === 'APARTAMENTO')
        .sort((a, b) => a.code.localeCompare(b.code));

      const parkings = building.units
        .filter((u) => u.unitType === 'ESTACIONAMIENTO')
        .sort((a, b) => a.code.localeCompare(b.code));

      console.log(`→ ${tenant.name} / ${building.name}`);
      console.log(`  Apartamentos: ${apartments.length}`);
      console.log(`  Estacionamientos: ${parkings.length}`);

      const maxAssociations = Math.min(apartments.length, parkings.length);

      for (let i = 0; i < maxAssociations; i++) {
        const apartment = apartments[i];
        const parking = parkings[i];

        if (!apartment || !parking) continue;

        try {
          // Verificar si ya existe la asociación
          const existing = await prisma.unitAssociation.findFirst({
            where: {
              apartmentId: apartment.id,
              parkingId: parking.id,
            },
          });

          if (existing) {
            console.log(`  ⏭️  ${apartment.code} ↔ ${parking.code} (ya existe)`);
            continue;
          }

          await prisma.unitAssociation.create({
            data: {
              tenantId: tenant.id,
              buildingId: building.id,
              apartmentId: apartment.id,
              parkingId: parking.id,
            },
          });

          console.log(`  ✅ ${apartment.code} ↔ ${parking.code}`);
          totalAssociations++;
        } catch (error) {
          console.log(`  ❌ Error asociando ${apartment.code} ↔ ${parking.code}: ${error}`);
        }
      }

      // Estacionamientos sobrantes (sin asociar)
      if (parkings.length > apartments.length) {
        const unassigned = parkings.slice(apartments.length);
        console.log(`  📍 Estacionamientos sin asignar: ${unassigned.length}`);
        for (const parking of unassigned) {
          console.log(`     - ${parking.code} (del condominio)`);
        }
      }
    }
  }

  console.log(`\n✅ Asociación completada. ${totalAssociations} estacionamientos asociados.`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
