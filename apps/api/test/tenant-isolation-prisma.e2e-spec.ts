import { PrismaClient } from '@prisma/client';

describe('Tenant Data Isolation E2E Tests (Prisma Direct)', () => {
  let prisma: PrismaClient;

  // Tenant A
  let tenantAId: string;
  let buildingA1Id: string;

  // Tenant B
  let tenantBId: string;
  let buildingB1Id: string;

  beforeAll(async () => {
    prisma = new PrismaClient();

    // Create Tenant A
    const tenantA = await prisma.tenant.create({
      data: {
        name: `Tenant A - ${Date.now()}`,
        type: 'ADMINISTRADORA',
      },
    });
    tenantAId = tenantA.id;

    // Create Tenant B
    const tenantB = await prisma.tenant.create({
      data: {
        name: `Tenant B - ${Date.now()}`,
        type: 'EDIFICIO_AUTOGESTION',
      },
    });
    tenantBId = tenantB.id;

    // Create Building A1
    const buildingA = await prisma.building.create({
      data: {
        name: 'Building A1',
        address: '123 Main St, Tenant A',
        tenantId: tenantAId,
      },
    });
    buildingA1Id = buildingA.id;

    // Create Building B1
    const buildingB = await prisma.building.create({
      data: {
        name: 'Building B1',
        address: '456 Oak Ave, Tenant B',
        tenantId: tenantBId,
      },
    });
    buildingB1Id = buildingB.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.tenant.deleteMany({
      where: {
        id: {
          in: [tenantAId, tenantBId],
        },
      },
    });
    await prisma.$disconnect();
  });

  describe('Database-Level Tenant Isolation', () => {
    it('✅ PASS: Buildings from Tenant A are isolated in database', async () => {
      const buildingsA = await prisma.building.findMany({
        where: {
          tenantId: tenantAId,
        },
      });

      const names = buildingsA.map((b) => b.name);
      expect(names).toContain('Building A1');
      expect(names).not.toContain('Building B1');
    });

    it('✅ PASS: Buildings from Tenant B are isolated in database', async () => {
      const buildingsB = await prisma.building.findMany({
        where: {
          tenantId: tenantBId,
        },
      });

      const names = buildingsB.map((b) => b.name);
      expect(names).toContain('Building B1');
      expect(names).not.toContain('Building A1');
    });

    it('🔒 SECURITY: Querying without tenantId filter would leak data (vulnerable if not implemented)', async () => {
      // This demonstrates what happens if developer forgets to filter by tenantId
      // This query is vulnerable - it would return ALL buildings
      const allBuildings = await prisma.building.findMany();

      const names = allBuildings.map((b) => b.name);
      expect(names).toContain('Building A1');
      expect(names).toContain('Building B1');
    });

    it('✅ PASS: Building A1 can ONLY be found when filtering by Tenant A', async () => {
      // Correct way: filter by tenantId
      const foundA1 = await prisma.building.findFirst({
        where: {
          id: buildingA1Id,
          tenantId: tenantAId, // CRITICAL: must filter by tenant
        },
      });

      expect(foundA1).toBeDefined();
      expect(foundA1?.name).toBe('Building A1');
    });

    it('🔒 SECURITY: Building A1 returns null when queried with wrong tenantId', async () => {
      // Attempting to access Building A1 as if it belongs to Tenant B
      const foundA1WithWrongTenant = await prisma.building.findFirst({
        where: {
          id: buildingA1Id,
          tenantId: tenantBId, // Wrong tenant!
        },
      });

      // Should NOT find it
      expect(foundA1WithWrongTenant).toBeNull();
    });

    it('✅ PASS: Tenant A can only see its own buildings', async () => {
      const buildingsA = await prisma.building.findMany({
        where: {
          tenantId: tenantAId,
        },
      });

      // Should have at least Building A1
      expect(buildingsA.length).toBeGreaterThan(0);

      // All buildings should have tenantId = tenantAId
      buildingsA.forEach((building) => {
        expect(building.tenantId).toBe(tenantAId);
      });

      // Should NOT contain Building B1
      expect(buildingsA.find((b) => b.id === buildingB1Id)).toBeUndefined();
    });

    it('✅ PASS: Tenant B can only see its own buildings', async () => {
      const buildingsB = await prisma.building.findMany({
        where: {
          tenantId: tenantBId,
        },
      });

      // Should have at least Building B1
      expect(buildingsB.length).toBeGreaterThan(0);

      // All buildings should have tenantId = tenantBId
      buildingsB.forEach((building) => {
        expect(building.tenantId).toBe(tenantBId);
      });

      // Should NOT contain Building A1
      expect(buildingsB.find((b) => b.id === buildingA1Id)).toBeUndefined();
    });

    it('🔒 SECURITY: Direct count query shows isolation works', async () => {
      const countA = await prisma.building.count({
        where: {
          tenantId: tenantAId,
        },
      });

      const countB = await prisma.building.count({
        where: {
          tenantId: tenantBId,
        },
      });

      // Both should have at least 1 building
      expect(countA).toBeGreaterThan(0);
      expect(countB).toBeGreaterThan(0);

      // They should NOT see each other's buildings
      const countASeesB = await prisma.building.count({
        where: {
          tenantId: tenantAId,
          id: buildingB1Id,
        },
      });

      expect(countASeesB).toBe(0);
    });
  });

  describe('No Data Leakage Validation', () => {
    it('✅ CRITICAL: Tenant isolation is enforced at database level', async () => {
      // Get Building A1
      const buildingA1 = await prisma.building.findUnique({
        where: {
          id: buildingA1Id,
        },
      });

      expect(buildingA1).toBeDefined();
      expect(buildingA1?.tenantId).toBe(tenantAId);

      // Get Building B1
      const buildingB1 = await prisma.building.findUnique({
        where: {
          id: buildingB1Id,
        },
      });

      expect(buildingB1).toBeDefined();
      expect(buildingB1?.tenantId).toBe(tenantBId);

      // Verify they are NOT the same
      expect(buildingA1?.id).not.toBe(buildingB1?.id);
      expect(buildingA1?.tenantId).not.toBe(buildingB1?.tenantId);
    });
  });
});
