import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================================================
// TYPES
// ============================================================================

interface BuildingInfo {
  id: string;
  name: string;
  alias: string;
}

interface UnitInfo {
  id: string;
  code: string;
  label: string | null;
  unitType: string;
  buildingId: string;
}

interface AssociationInfo {
  id: string;
  apartmentId: string;
  parkingId: string;
  buildingId: string;
}

interface ApartmentChange {
  unitId: string;
  buildingName: string;
  oldCode: string;
  newCode: string;
}

interface ParkingChange {
  parkingId: string;
  oldCode: string;
  newCode: string;
  apartmentId: string;
  apartmentCode: string;
  buildingName: string;
  associationId: string;
  label: string | null;
}

interface OrphanParking {
  parkingId: string;
  oldCode: string;
  buildingName: string;
  reason: string;
}

interface Conflict {
  unitId: string;
  oldCode: string;
  attemptedNewCode: string;
  reason: string;
}

interface CrossBuildingIssue {
  associationId: string;
  apartmentId: string;
  apartmentBuildingId: string;
  parkingId: string;
  parkingBuildingId: string;
  reason: string;
}

interface MigrationResult {
  apartmentChanges: ApartmentChange[];
  parkingChanges: ParkingChange[];
  orphanParkings: OrphanParking[];
  conflicts: Conflict[];
  crossBuildingIssues: CrossBuildingIssue[];
  skippedApartments: ApartmentChange[];
  skippedParkings: ParkingChange[];
}

// ============================================================================
// HELPERS
// ============================================================================

function extractBaseCode(code: string): string {
  // Remove known prefixes: A-, B-, AP-, BP-
  return code.replace(/^(A|B|AP|BP)-/, '');
}

function getBuildingPrefix(buildingName: string): string {
  if (buildingName === 'Torre A') return 'A';
  if (buildingName === 'Torre B') return 'B';
  return buildingName.replace(/\s+/g, '').substring(0, 1).toUpperCase();
}

function getParkingPrefix(buildingName: string): string {
  if (buildingName === 'Torre A') return 'AP';
  if (buildingName === 'Torre B') return 'BP';
  return `${getBuildingPrefix(buildingName)}P`;
}

// ============================================================================
// MAIN MIGRATION LOGIC
// ============================================================================

async function runMigration(dryRun: boolean): Promise<MigrationResult> {
  console.log(`\n🏢 Migración de códigos: Residencia San Cristóbal`);
  console.log(`   Modo: ${dryRun ? '🔍 DRY-RUN' : '✏️  EJECUCIÓN REAL'}\n`);

  // --- 1. Find tenant -------------------------------------------------------
  const tenant = await prisma.tenant.findFirst({
    where: { name: 'Residencia San Cristóbal' },
  });

  if (!tenant) {
    throw new Error('❌ Tenant "Residencia San Cristóbal" no encontrado');
  }
  console.log(`✅ Tenant encontrado: ${tenant.id}\n`);

  // --- 2. Find buildings ----------------------------------------------------
  const buildings = await prisma.building.findMany({
    where: { tenantId: tenant.id },
  });

  const torreA = buildings.find((b) => b.name === 'Torre A');
  const torreB = buildings.find((b) => b.name === 'Torre B');

  if (!torreA || !torreB) {
    throw new Error('❌ No se encontraron Torre A y/o Torre B');
  }

  const buildingMap = new Map<string, BuildingInfo>();
  buildings.forEach((b) => buildingMap.set(b.id, { id: b.id, name: b.name, alias: b.alias }));

  console.log(`🏢 Edificios:`);
  console.log(`   Torre A: ${torreA.id} (alias: ${torreA.alias})`);
  console.log(`   Torre B: ${torreB.id} (alias: ${torreB.alias})\n`);

  // --- 3. Load all units in scope -------------------------------------------
  const allUnits = await prisma.unit.findMany({
    where: {
      tenantId: tenant.id,
      buildingId: { in: [torreA.id, torreB.id] },
    },
    select: {
      id: true,
      code: true,
      label: true,
      unitType: true,
      buildingId: true,
    },
  });

  const unitMap = new Map<string, UnitInfo>();
  allUnits.forEach((u) => unitMap.set(u.id, { ...u, label: u.label }));

  const apartments = allUnits.filter((u) => u.unitType === 'APARTAMENTO');
  const parkings = allUnits.filter((u) => u.unitType === 'ESTACIONAMIENTO');

  console.log(`📊 Unidades cargadas:`);
  console.log(`   Apartamentos: ${apartments.length}`);
  console.log(`   Estacionamientos: ${parkings.length}`);
  console.log(`   Total: ${allUnits.length}\n`);

  // --- 4. Load associations -------------------------------------------------
  const associations = await prisma.unitAssociation.findMany({
    where: {
      tenantId: tenant.id,
      buildingId: { in: [torreA.id, torreB.id] },
    },
    select: {
      id: true,
      apartmentId: true,
      parkingId: true,
      buildingId: true,
    },
  });

  console.log(`🔗 Asociaciones cargadas: ${associations.length}\n`);

  // Build reverse lookups
  const parkingToAssociation = new Map<string, AssociationInfo>();
  const apartmentToParkings = new Map<string, AssociationInfo[]>();

  for (const assoc of associations) {
    parkingToAssociation.set(assoc.parkingId, assoc);

    const list = apartmentToParkings.get(assoc.apartmentId) || [];
    list.push(assoc);
    apartmentToParkings.set(assoc.apartmentId, list);
  }

  // --- 5. Initialize result containers --------------------------------------
  const result: MigrationResult = {
    apartmentChanges: [],
    parkingChanges: [],
    orphanParkings: [],
    conflicts: [],
    crossBuildingIssues: [],
    skippedApartments: [],
    skippedParkings: [],
  };

  // Track new codes to detect duplicates within the migration
  const newCodesInBuilding = new Map<string, Set<string>>(); // buildingId -> Set<newCode>

  function wouldConflict(buildingId: string, newCode: string, unitId: string): boolean {
    // Check against other planned changes
    const planned = newCodesInBuilding.get(buildingId);
    if (planned?.has(newCode)) return true;

    // Check against existing units in DB (excluding self)
    // This is done per-unit below for clarity
    return false;
  }

  // --- 6. Process apartments ------------------------------------------------
  console.log('🔄 Procesando apartamentos...\n');

  for (const apartment of apartments) {
    const building = buildingMap.get(apartment.buildingId);
    if (!building) {
      result.conflicts.push({
        unitId: apartment.id,
        oldCode: apartment.code,
        attemptedNewCode: 'N/A',
        reason: 'Edificio no encontrado',
      });
      continue;
    }

    const baseCode = extractBaseCode(apartment.code);
    const prefix = getBuildingPrefix(building.name);
    const newCode = `${prefix}-${baseCode}`;

    // Check if code would conflict with existing DB unit (excluding self)
    const existingConflict = await prisma.unit.findFirst({
      where: {
        tenantId: tenant.id,
        buildingId: apartment.buildingId,
        code: newCode,
        id: { not: apartment.id },
      },
    });

    if (existingConflict) {
      result.conflicts.push({
        unitId: apartment.id,
        oldCode: apartment.code,
        attemptedNewCode: newCode,
        reason: `Ya existe unidad con código ${newCode} en ${building.name}`,
      });
      continue;
    }

    // Check duplicate within planned changes
    if (wouldConflict(apartment.buildingId, newCode, apartment.id)) {
      result.conflicts.push({
        unitId: apartment.id,
        oldCode: apartment.code,
        attemptedNewCode: newCode,
        reason: `Duplicado planificado en ${building.name}`,
      });
      continue;
    }

    // Mark as planned
    if (!newCodesInBuilding.has(apartment.buildingId)) {
      newCodesInBuilding.set(apartment.buildingId, new Set());
    }
    newCodesInBuilding.get(apartment.buildingId)!.add(newCode);

    const change: ApartmentChange = {
      unitId: apartment.id,
      buildingName: building.name,
      oldCode: apartment.code,
      newCode,
    };

    if (newCode === apartment.code) {
      result.skippedApartments.push(change);
    } else {
      result.apartmentChanges.push(change);
    }
  }

  // --- 7. Process parkings --------------------------------------------------
  console.log('🔄 Procesando estacionamientos...\n');

  for (const parking of parkings) {
    const building = buildingMap.get(parking.buildingId);
    if (!building) {
      result.orphanParkings.push({
        parkingId: parking.id,
        oldCode: parking.code,
        buildingName: 'Desconocido',
        reason: 'Edificio no encontrado',
      });
      continue;
    }

    // Check if parking has an association
    const assoc = parkingToAssociation.get(parking.id);
    if (!assoc) {
      result.orphanParkings.push({
        parkingId: parking.id,
        oldCode: parking.code,
        buildingName: building.name,
        reason: 'No tiene apartamento asociado',
      });
      continue;
    }

    // Check cross-building consistency
    const apartment = unitMap.get(assoc.apartmentId);
    if (!apartment) {
      result.orphanParkings.push({
        parkingId: parking.id,
        oldCode: parking.code,
        buildingName: building.name,
        reason: `Apartamento asociado ${assoc.apartmentId} no encontrado`,
      });
      continue;
    }

    if (apartment.buildingId !== parking.buildingId) {
      result.crossBuildingIssues.push({
        associationId: assoc.id,
        apartmentId: apartment.id,
        apartmentBuildingId: apartment.buildingId,
        parkingId: parking.id,
        parkingBuildingId: parking.buildingId,
        reason: `Apartamento en ${buildingMap.get(apartment.buildingId)?.name} pero parking en ${building.name}`,
      });
      // Still process it but flag it
    }

    // Calculate new code from associated apartment
    const baseCode = extractBaseCode(apartment.code);
    const parkingPrefix = getParkingPrefix(building.name);
    let newCode = `${parkingPrefix}-${baseCode}`;

    // Handle multiple parkings for same apartment
    const apartmentParkings = apartmentToParkings.get(apartment.id) || [];
    const parkingIndex = apartmentParkings.findIndex((p) => p.parkingId === parking.id);

    if (parkingIndex > 0) {
      newCode = `${newCode}-${parkingIndex}`;
    }

    // Check conflict with existing DB unit (excluding self)
    const existingConflict = await prisma.unit.findFirst({
      where: {
        tenantId: tenant.id,
        buildingId: parking.buildingId,
        code: newCode,
        id: { not: parking.id },
      },
    });

    if (existingConflict) {
      result.conflicts.push({
        unitId: parking.id,
        oldCode: parking.code,
        attemptedNewCode: newCode,
        reason: `Ya existe unidad con código ${newCode} en ${building.name}`,
      });
      continue;
    }

    // Check duplicate within planned changes
    if (wouldConflict(parking.buildingId, newCode, parking.id)) {
      result.conflicts.push({
        unitId: parking.id,
        oldCode: parking.code,
        attemptedNewCode: newCode,
        reason: `Duplicado planificado en ${building.name}`,
      });
      continue;
    }

    // Mark as planned
    if (!newCodesInBuilding.has(parking.buildingId)) {
      newCodesInBuilding.set(parking.buildingId, new Set());
    }
    newCodesInBuilding.get(parking.buildingId)!.add(newCode);

    // Build label with old code reference
    const newLabel = parking.label?.includes('(antes')
      ? parking.label // Don't overwrite if already migrated
      : `Puesto ${newCode} (antes ${parking.code})`;

    const change: ParkingChange = {
      parkingId: parking.id,
      oldCode: parking.code,
      newCode,
      apartmentId: apartment.id,
      apartmentCode: apartment.code,
      buildingName: building.name,
      associationId: assoc.id,
      label: newLabel,
    };

    if (newCode === parking.code) {
      result.skippedParkings.push(change);
    } else {
      result.parkingChanges.push(change);
    }
  }

  // --- 8. Print dry-run report ----------------------------------------------
  printReport(result);

  // --- 9. Execute if not dry-run --------------------------------------------
  if (!dryRun) {
    if (result.conflicts.length > 0 || result.crossBuildingIssues.length > 0) {
      console.log('\n⛔ NO SE EJECUTA: Hay conflictos o inconsistencias. Resolvélos primero.\n');
      return result;
    }

    console.log('\n🚀 Ejecutando migración en transacción...\n');

    await prisma.$transaction(async (tx) => {
      // Update apartments
      for (const change of result.apartmentChanges) {
        await tx.unit.update({
          where: { id: change.unitId },
          data: { code: change.newCode },
        });
        console.log(`   ✅ Apartamento ${change.oldCode} → ${change.newCode} (${change.buildingName})`);
      }

      // Update parkings
      for (const change of result.parkingChanges) {
        await tx.unit.update({
          where: { id: change.parkingId },
          data: {
            code: change.newCode,
            label: change.label,
          },
        });
        console.log(`   ✅ Parking ${change.oldCode} → ${change.newCode} (${change.buildingName}) [label: ${change.label}]`);
      }
    });

    console.log('\n✅ Migración completada exitosamente.\n');
  }

  return result;
}

// ============================================================================
// REPORT
// ============================================================================

function printReport(result: MigrationResult) {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║              REPORTE: DRY-RUN MIGRACIÓN                        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Apartments
  console.log(`📦 APARTAMENTOS A CAMBIAR: ${result.apartmentChanges.length}`);
  if (result.apartmentChanges.length > 0) {
    console.log('─────────────────────────────────────────────────────────────────');
    console.table(
      result.apartmentChanges.map((c) => ({
        'ID': c.unitId.substring(0, 8) + '...',
        'Edificio': c.buildingName,
        'Código Anterior': c.oldCode,
        'Código Nuevo': c.newCode,
      }))
    );
  }

  console.log(`\n⏭️  Apartamentos sin cambios: ${result.skippedApartments.length}`);

  // Parkings
  console.log(`\n🚗 ESTACIONAMIENTOS A CAMBIAR: ${result.parkingChanges.length}`);
  if (result.parkingChanges.length > 0) {
    console.log('─────────────────────────────────────────────────────────────────');
    console.table(
      result.parkingChanges.map((c) => ({
        'ID': c.parkingId.substring(0, 8) + '...',
        'Edificio': c.buildingName,
        'Código Anterior': c.oldCode,
        'Código Nuevo': c.newCode,
        'Apartamento': c.apartmentCode,
        'Label': c.label,
      }))
    );
  }

  console.log(`\n⏭️  Estacionamientos sin cambios: ${result.skippedParkings.length}`);

  // Orphans
  console.log(`\n⚠️  ESTACIONAMIENTOS HUÉRFANOS: ${result.orphanParkings.length}`);
  if (result.orphanParkings.length > 0) {
    console.log('─────────────────────────────────────────────────────────────────');
    console.table(
      result.orphanParkings.map((o) => ({
        'ID': o.parkingId.substring(0, 8) + '...',
        'Edificio': o.buildingName,
        'Código Actual': o.oldCode,
        'Razón': o.reason,
      }))
    );
  }

  // Cross-building
  console.log(`\n🚨 INCONSISTENCIAS CROSS-BUILDING: ${result.crossBuildingIssues.length}`);
  if (result.crossBuildingIssues.length > 0) {
    console.log('─────────────────────────────────────────────────────────────────');
    console.table(
      result.crossBuildingIssues.map((i) => ({
        'Asociación': i.associationId.substring(0, 8) + '...',
        'Apartamento': i.apartmentId.substring(0, 8) + '...',
        'Parking': i.parkingId.substring(0, 8) + '...',
        'Razón': i.reason,
      }))
    );
  }

  // Conflicts
  console.log(`\n❌ CONFLICTOS DETECTADOS: ${result.conflicts.length}`);
  if (result.conflicts.length > 0) {
    console.log('─────────────────────────────────────────────────────────────────');
    console.table(
      result.conflicts.map((c) => ({
        'Unidad': c.unitId.substring(0, 8) + '...',
        'Código Actual': c.oldCode,
        'Código Intentado': c.attemptedNewCode,
        'Razón': c.reason,
      }))
    );
  }

  console.log('\n═════════════════════════════════════════════════════════════════\n');
}

// ============================================================================
// ENTRY POINT
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');

  if (dryRun) {
    console.log('ℹ️  Modo dry-run. Agregá --execute para aplicar cambios reales.\n');
  }

  const result = await runMigration(dryRun);

  // Summary for CI/automation
  console.log('📊 RESUMEN EJECUTIVO:');
  console.log(`   Apartamentos a cambiar: ${result.apartmentChanges.length}`);
  console.log(`   Estacionamientos a cambiar: ${result.parkingChanges.length}`);
  console.log(`   Huérfanos: ${result.orphanParkings.length}`);
  console.log(`   Conflictos: ${result.conflicts.length}`);
  console.log(`   Cross-building: ${result.crossBuildingIssues.length}`);

  await prisma.$disconnect();
}

main()
  .catch((e) => {
    console.error('\n❌ Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
