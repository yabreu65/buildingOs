import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { LiquidationEngineService } from './liquidation-engine.service';

describe('LiquidationEngineService', () => {
  let service: LiquidationEngineService;
  let prisma: PrismaService;
  let auditService: AuditService;
  let validators: FinanzasValidators;

  const tenantId = 'tenant-123';
  const buildingId = 'building-456';
  const membershipId = 'member-789';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiquidationEngineService,
        {
          provide: PrismaService,
          useValue: {
            expense: { findMany: jest.fn() },
            unit: { findMany: jest.fn() },
            liquidation: {
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              delete: jest.fn(),
              deleteMany: jest.fn(),
            },
            charge: {
              createMany: jest.fn(),
              findMany: jest.fn(),
              deleteMany: jest.fn(),
            },
            membership: {
              findFirst: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: { createLog: jest.fn(), createLogRequired: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: FinanzasValidators,
          useValue: {
            isAdminOrOperator: jest.fn().mockReturnValue(true),
            validateBuildingBelongsToTenant: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    service = module.get<LiquidationEngineService>(LiquidationEngineService);
    prisma = module.get<PrismaService>(PrismaService);
    auditService = module.get<AuditService>(AuditService);
    validators = module.get<FinanzasValidators>(FinanzasValidators);
    jest.spyOn(prisma, '$transaction').mockImplementation(
      async (callback) => callback(prisma),
    );
    jest.spyOn(prisma.membership, 'findFirst').mockResolvedValue({
      id: membershipId,
      tenantId,
      roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }],
    } as never);
  });

  describe('createLiquidationDraft', () => {
    it('debería crear liquidación draft con expenses validadas', async () => {
      const expenses = [
        {
          id: 'exp-1',
          amountMinor: 100000,
          currencyCode: 'ARS',
          category: { name: 'Electricidad' },
          vendor: { name: 'EDENOR' },
          allocations: [],
        },
        {
          id: 'exp-2',
          amountMinor: 50000,
          currencyCode: 'ARS',
          category: { name: 'Agua' },
          vendor: null,
          allocations: [],
        },
      ];

      const units = [
        { id: 'unit-1', code: 'A-101', label: '101', m2: 100 },
        { id: 'unit-2', code: 'A-102', label: '102', m2: 150 },
      ];

      const persistedMembershipId = 'member-persisted-create';
      jest.spyOn(prisma.membership, 'findFirst').mockResolvedValueOnce({
        id: persistedMembershipId,
        tenantId,
        roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }],
      } as never);
      jest
        .spyOn(prisma.expense, 'findMany')
        .mockResolvedValueOnce(expenses as never)
        .mockResolvedValueOnce([] as never);
      jest.spyOn(prisma.unit, 'findMany').mockResolvedValue(units as never);
      const createSpy = jest.spyOn(prisma.liquidation, 'create').mockResolvedValue({
        id: 'liq-1',
        tenantId,
        buildingId,
        period: '2026-04',
        status: 'DRAFT',
        baseCurrency: 'ARS',
        totalAmountMinor: 150000,
        totalsByCurrency: { ARS: 150000 },
        unitCount: 2,
      } as never);

      const result = await service.createLiquidationDraft(
        tenantId,
        buildingId,
        '2026-04',
        'ARS',
        membershipId,
      );

      expect(result.liquidation.id).toBe('liq-1');
      expect(result.liquidation.status).toBe('DRAFT');
      expect(result.chargesPreview.length).toBe(2);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            generatedByMembershipId: persistedMembershipId,
          }),
        }),
      );
      expect(auditService.createLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LIQUIDATION_DRAFT',
          actorMembershipId: persistedMembershipId,
        }),
        prisma,
      );
    });

    it('debería lanzar error si no hay gastos validados', async () => {
      jest
        .spyOn(prisma.expense, 'findMany')
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await expect(
        service.createLiquidationDraft(
          tenantId,
          buildingId,
          '2026-04',
          'ARS',
          membershipId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debería lanzar error si no hay unidades billables', async () => {
      const expenses = [
        {
          id: 'exp-1',
          amountMinor: 100000,
          currencyCode: 'ARS',
          category: { name: 'Electricidad' },
          vendor: { name: 'EDENOR' },
          allocations: [],
          scopeType: 'BUILDING',
        },
      ];

      jest
        .spyOn(prisma.expense, 'findMany')
        .mockResolvedValueOnce(expenses as never)
        .mockResolvedValueOnce([]);
      jest.spyOn(prisma.unit, 'findMany').mockResolvedValue([]);

      await expect(
        service.createLiquidationDraft(
          tenantId,
          buildingId,
          '2026-04',
          'ARS',
          membershipId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debería rechazar una membresía inexistente aunque el JWT tenga rol ADMIN', async () => {
      jest.spyOn(prisma.membership, 'findFirst').mockResolvedValueOnce(null);

      await expect(
        service.createLiquidationDraft(
          tenantId,
          buildingId,
          '2026-04',
          'ARS',
          membershipId,
        ),
      ).rejects.toThrow('No se encontró una membresía válida para el tenant');
    });

    it('debería rechazar una membresía de otro tenant', async () => {
      jest.spyOn(prisma.membership, 'findFirst').mockResolvedValueOnce(null);

      await expect(
        service.createLiquidationDraft(
          'tenant-other',
          buildingId,
          '2026-04',
          'ARS',
          membershipId,
        ),
      ).rejects.toThrow('No se encontró una membresía válida para el tenant');
    });

    it('debería rechazar una membresía sin rol TENANT autorizado', async () => {
      jest.spyOn(validators, 'isAdminOrOperator').mockReturnValueOnce(false);
      jest.spyOn(prisma.membership, 'findFirst').mockResolvedValueOnce({
        id: membershipId,
        tenantId,
        roles: [{ role: 'TENANT_ADMIN', scopeType: 'BUILDING' }],
      } as never);

      await expect(
        service.createLiquidationDraft(
          tenantId,
          buildingId,
          '2026-04',
          'ARS',
          membershipId,
        ),
      ).rejects.toThrow('Solo administradores pueden gestionar liquidaciones');
    });
  });

  describe('reviewLiquidation', () => {
    it('debería cambiar estado DRAFT → REVIEWED y persistir reviewedByMembershipId', async () => {
      const liquidation = {
        id: 'liq-1',
        status: 'DRAFT',
        period: '2026-04',
      };
      const reviewedLiquidation = {
        ...liquidation,
        status: 'REVIEWED',
        reviewedByMembershipId: membershipId,
      };

      jest.spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValueOnce(liquidation as never)
        .mockResolvedValueOnce(reviewedLiquidation as never);
      const updateManySpy = jest
        .spyOn(prisma.liquidation, 'updateMany')
        .mockResolvedValue({ count: 1 });

      const result = await service.reviewLiquidation(
        tenantId,
        'liq-1',
        membershipId
      );

      expect(result.status).toBe('REVIEWED');
      expect(result.reviewedByMembershipId).toBe(membershipId);
      expect(updateManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'liq-1',
            tenantId,
            status: 'DRAFT',
          },
        }),
      );

      const updateArgs = updateManySpy.mock.calls[0][0];
      expect(updateArgs.data.reviewedAt).toBeInstanceOf(Date);
      expect(updateArgs.data.updatedAt).toBe(updateArgs.data.reviewedAt);
      expect(updateArgs.data.reviewedByMembershipId).toBe(membershipId);
      expect(auditService.createLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LIQUIDATION_REVIEW',
          actorMembershipId: membershipId,
          metadata: expect.objectContaining({
            period: '2026-04',
            previousStatus: 'DRAFT',
          }),
        }),
        prisma,
      );
    });

    it('debería lanzar error si liquidación no existe', async () => {
      jest.spyOn(prisma.liquidation, 'findFirst').mockResolvedValueOnce(null);

      await expect(
        service.reviewLiquidation(
          tenantId,
          'liq-not-found',
          membershipId
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('debería lanzar error si status no es DRAFT', async () => {
      jest
        .spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValueOnce({ id: 'liq-1', status: 'PUBLISHED', period: '2026-04' } as never);

      await expect(
        service.reviewLiquidation(
          tenantId,
          'liq-1',
          membershipId
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debería lanzar error si la carrera deja la liquidación sin actualizar', async () => {
      jest
        .spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValueOnce({ id: 'liq-1', status: 'DRAFT', period: '2026-04' } as never);
      jest.spyOn(prisma.liquidation, 'updateMany').mockResolvedValue({ count: 0 });

      await expect(
        service.reviewLiquidation(
          tenantId,
          'liq-1',
          membershipId
        ),
      ).rejects.toThrow('No fue posible revisar la liquidación porque cambió de estado');
    });

    it('debería revertir la revisión si falla la auditoría obligatoria', async () => {
      const liquidation = {
        id: 'liq-1',
        status: 'DRAFT',
        period: '2026-04',
      };
      let persistedStatus = 'DRAFT';
      const transactionClient = {
        ...prisma,
        liquidation: {
          ...prisma.liquidation,
          findFirst: jest.fn().mockImplementation(async () => (
            persistedStatus === 'REVIEWED'
              ? {
                ...liquidation,
                status: 'REVIEWED',
                reviewedByMembershipId: membershipId,
              }
              : liquidation
          )),
          updateMany: jest.fn().mockImplementation(async ({ data }) => {
            persistedStatus = data.status;
            return { count: 1 };
          }),
        },
      };

      jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
        const snapshot = persistedStatus;
        try {
          return await callback(transactionClient);
        } catch (error) {
          persistedStatus = snapshot;
          throw error;
        }
      });
      jest.spyOn(auditService, 'createLogRequired').mockRejectedValueOnce(new Error('audit failed'));
      jest.spyOn(prisma.liquidation, 'findFirst').mockResolvedValueOnce(liquidation as never);

      await expect(
        service.reviewLiquidation(
          tenantId,
          'liq-1',
          membershipId
        ),
      ).rejects.toThrow('audit failed');

      expect(persistedStatus).toBe('DRAFT');
    });
  });

  describe('publishLiquidation', () => {
    it('debería cambiar estado REVIEWED → PUBLISHED y crear charges', async () => {
      const liquidation = {
        id: 'liq-1',
        status: 'REVIEWED',
        buildingId,
        period: '2026-04',
        baseCurrency: 'ARS',
      };

      const expenses = [
        {
          id: 'exp-1',
          amountMinor: 120000,
          currencyCode: 'ARS',
          category: { name: 'Electricidad' },
          vendor: { name: 'EDENOR' },
          invoiceDate: new Date('2026-04-10'),
          description: 'Servicio eléctrico',
          allocations: [],
          scopeType: 'BUILDING',
        },
      ];

      const units = [
        { id: 'unit-1', code: 'A-101', label: '101', m2: 100 },
        { id: 'unit-2', code: 'A-102', label: '102', m2: 200 },
      ];

      const persistedMembershipId = 'member-persisted-publish';
      jest.spyOn(prisma.membership, 'findFirst').mockResolvedValueOnce({
        id: persistedMembershipId,
        tenantId,
        roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }],
      } as never);
      jest
        .spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValue(liquidation as never);
      jest
        .spyOn(prisma.expense, 'findMany')
        .mockResolvedValueOnce(expenses as never)
        .mockResolvedValueOnce([] as never);
      jest.spyOn(prisma.unit, 'findMany').mockResolvedValue(units as never);
      jest
        .spyOn(prisma.charge, 'createMany')
        .mockResolvedValue({ count: 2 });
      jest
        .spyOn(prisma.liquidation, 'update')
        .mockResolvedValue({
          ...liquidation,
          status: 'PUBLISHED',
        } as never);

      const dueDate = new Date('2026-05-30');
      const result = await service.publishLiquidation(
        tenantId,
        'liq-1',
        dueDate,
        membershipId,
      );

      expect(result.status).toBe('PUBLISHED');
      expect(prisma.charge.createMany).toHaveBeenCalled();
      expect(prisma.liquidation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            publicationSnapshot: expect.objectContaining({
              version: 1,
              liquidationId: 'liq-1',
              totalAmountMinor: 120000,
              publishedAt: expect.any(String),
              allocations: expect.arrayContaining([
                expect.objectContaining({ unitId: 'unit-1' }),
              ]),
            }),
            publishedAt: expect.any(Date),
            publishedByMembershipId: persistedMembershipId,
          }),
        }),
      );
      expect(auditService.createLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LIQUIDATION_PUBLISH',
          actorMembershipId: persistedMembershipId,
        }),
        prisma,
      );
    });

    it('debería distribuir centavos exactos con Largest Remainder y reflejarlos en la snapshot', async () => {
      const liquidation = {
        id: 'liq-1',
        status: 'REVIEWED',
        buildingId,
        period: '2026-04',
        baseCurrency: 'ARS',
      };

      const expenses = [
        {
          id: 'exp-1',
          amountMinor: 100,
          currencyCode: 'ARS',
          category: { name: 'Electricidad' },
          vendor: { name: 'EDENOR' },
          invoiceDate: new Date('2026-04-10'),
          description: 'Servicio eléctrico',
          allocations: [],
          scopeType: 'BUILDING',
        },
      ];

      const units = [
        { id: 'unit-c', code: 'C-103', label: '103', m2: 1 },
        { id: 'unit-a', code: 'A-101', label: '101', m2: 1 },
        { id: 'unit-b', code: 'B-102', label: '102', m2: 1 },
      ];

      jest.spyOn(prisma.membership, 'findFirst').mockResolvedValueOnce({
        id: 'member-persisted-publish',
        tenantId,
        roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }],
      } as never);
      jest
        .spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValueOnce(liquidation as never);
      jest
        .spyOn(prisma.expense, 'findMany')
        .mockResolvedValueOnce(expenses as never)
        .mockResolvedValueOnce([] as never);
      jest.spyOn(prisma.unit, 'findMany').mockResolvedValue(units as never);
      const createManySpy = jest
        .spyOn(prisma.charge, 'createMany')
        .mockResolvedValue({ count: 3 });
      jest.spyOn(prisma.liquidation, 'update').mockImplementation(async ({ data }) => ({
        ...liquidation,
        status: 'PUBLISHED',
        publicationSnapshot: data.publicationSnapshot,
        publishedAt: data.publishedAt,
        publishedByMembershipId: data.publishedByMembershipId,
      }) as never);

      const result = await service.publishLiquidation(
        tenantId,
        'liq-1',
        new Date('2026-05-30'),
        membershipId,
      );

      expect(result.status).toBe('PUBLISHED');

      const chargeAmounts = createManySpy.mock.calls[0][0].data.map(
        (charge) => charge.amount,
      );
      expect(chargeAmounts).toEqual([34, 33, 33]);

      expect(
        (result.publicationSnapshot as {
          allocations: Array<{ unitId: string; amountMinor: number }>;
        }).allocations.map((allocation) => allocation.amountMinor),
      ).toEqual([34, 33, 33]);
      expect(
        (result.publicationSnapshot as {
          allocations: Array<{ unitId: string; amountMinor: number }>;
        }).allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0),
      ).toBe(100);
    });

    it('rolls back publication when required audit logging fails', async () => {
      const liquidation = {
        id: 'liq-1',
        status: 'REVIEWED',
        buildingId,
        period: '2026-04',
        baseCurrency: 'ARS',
      };
      const expenses = [{
        id: 'exp-1',
        amountMinor: 120000,
        currencyCode: 'ARS',
        category: { name: 'Electricidad' },
        vendor: { name: 'EDENOR' },
        invoiceDate: new Date('2026-04-10'),
        description: 'Servicio eléctrico',
        allocations: [],
        scopeType: 'BUILDING',
      }];
      const units = [
        { id: 'unit-1', code: 'A-101', label: '101', m2: 100 },
        { id: 'unit-2', code: 'A-102', label: '102', m2: 200 },
      ];
      let persistedStatus = 'REVIEWED';
      const transactionClient = {
        ...prisma,
        charge: {
          ...prisma.charge,
          createMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
        liquidation: {
          ...prisma.liquidation,
          update: jest.fn().mockImplementation(async () => ({
            ...liquidation,
            status: 'PUBLISHED',
          })),
        },
      };

      jest.spyOn(prisma.liquidation, 'findFirst').mockResolvedValue(liquidation as never);
      jest.spyOn(prisma.expense, 'findMany')
        .mockResolvedValueOnce(expenses as never)
        .mockResolvedValueOnce([] as never);
      jest.spyOn(prisma.unit, 'findMany').mockResolvedValue(units as never);
      jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
        try {
          const result = await callback(transactionClient);
          persistedStatus = 'PUBLISHED';
          return result;
        } catch (error) {
          throw error;
        }
      });
      jest.spyOn(auditService, 'createLogRequired').mockRejectedValueOnce(new Error('audit failed'));

      await expect(
        service.publishLiquidation(
          tenantId,
          liquidation.id,
          new Date('2026-05-30'),
          membershipId,
        ),
      ).rejects.toThrow('audit failed');

      expect(persistedStatus).toBe('REVIEWED');
      expect(transactionClient.charge.createMany).toHaveBeenCalledTimes(1);
      expect(transactionClient.liquidation.update).toHaveBeenCalledTimes(1);
      expect(auditService.createLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LIQUIDATION_PUBLISH' }),
        transactionClient,
      );
    });

    it('debería lanzar error si status no es REVIEWED', async () => {
      jest
        .spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValue({ id: 'liq-1', status: 'DRAFT' } as never);

      await expect(
        service.publishLiquidation(
          tenantId,
          'liq-1',
          new Date(),
          membershipId,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelLiquidation', () => {
    it('debería cambiar estado DRAFT → CANCELED sin borrar la liquidación ni los cargos', async () => {
      const liquidation = {
        id: 'liq-1',
        status: 'DRAFT',
        period: '2026-04',
      };
      const canceledLiquidation = {
        ...liquidation,
        status: 'CANCELED',
        canceledByMembershipId: membershipId,
      };

      jest
        .spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValueOnce(liquidation as never)
        .mockResolvedValueOnce(canceledLiquidation as never);
      const updateManySpy = jest
        .spyOn(prisma.liquidation, 'updateMany')
        .mockResolvedValue({ count: 1 });

      const result = await service.cancelLiquidation(
        tenantId,
        'liq-1',
        membershipId
      );

      expect(result.status).toBe('CANCELED');
      expect(result.canceledByMembershipId).toBe(membershipId);
      expect(prisma.charge.deleteMany).not.toHaveBeenCalled();
      expect(prisma.liquidation.delete).not.toHaveBeenCalled();
      expect(updateManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'liq-1',
            tenantId,
            status: { in: ['DRAFT', 'REVIEWED'] },
          },
        }),
      );
      const updateArgs = updateManySpy.mock.calls[0][0];
      expect(updateArgs.data.canceledAt).toBeInstanceOf(Date);
      expect(updateArgs.data.updatedAt).toBe(updateArgs.data.canceledAt);
      expect(updateArgs.data.canceledByMembershipId).toBe(membershipId);
      expect(auditService.createLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LIQUIDATION_CANCEL',
          actorMembershipId: membershipId,
          metadata: expect.objectContaining({
            period: '2026-04',
            previousStatus: 'DRAFT',
          }),
        }),
        prisma,
      );
    });

    it('debería permitir cancelar una liquidación REVIEWED', async () => {
      jest
        .spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValueOnce({ id: 'liq-1', status: 'REVIEWED', period: '2026-04' } as never)
        .mockResolvedValueOnce({
          id: 'liq-1',
          status: 'CANCELED',
          period: '2026-04',
        } as never);
      jest.spyOn(prisma.liquidation, 'updateMany').mockResolvedValue({ count: 1 });

      const result = await service.cancelLiquidation(
        tenantId,
        'liq-1',
        membershipId
      );

      expect(result.status).toBe('CANCELED');
    });

    it('debería rechazar cancelación directa de liquidaciones PUBLISHED', async () => {
      jest
        .spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValueOnce({ id: 'liq-1', status: 'PUBLISHED', period: '2026-04' } as never);

      await expect(
        service.cancelLiquidation(
          tenantId,
          'liq-1',
          membershipId
        ),
      ).rejects.toThrow('La liquidación publicada no se puede cancelar directamente');
    });

    it('debería rechazar una liquidación ya CANCELED', async () => {
      jest
        .spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValueOnce({ id: 'liq-1', status: 'CANCELED', period: '2026-04' } as never);

      await expect(
        service.cancelLiquidation(
          tenantId,
          'liq-1',
          membershipId
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debería lanzar error si la carrera deja la liquidación sin actualizar', async () => {
      jest
        .spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValueOnce({ id: 'liq-1', status: 'DRAFT', period: '2026-04' } as never);
      jest.spyOn(prisma.liquidation, 'updateMany').mockResolvedValue({ count: 0 });

      await expect(
        service.cancelLiquidation(
          tenantId,
          'liq-1',
          membershipId
        ),
      ).rejects.toThrow('No fue posible cancelar la liquidación porque cambió de estado');
    });

    it('debería revertir la cancelación si falla la auditoría obligatoria', async () => {
      const liquidation = {
        id: 'liq-1',
        status: 'DRAFT',
        period: '2026-04',
      };
      let persistedStatus = 'DRAFT';
      const transactionClient = {
        ...prisma,
        liquidation: {
          ...prisma.liquidation,
          findFirst: jest.fn().mockImplementation(async () => (
            persistedStatus === 'CANCELED'
              ? {
                ...liquidation,
                status: 'CANCELED',
                canceledByMembershipId: membershipId,
              }
              : liquidation
          )),
          updateMany: jest.fn().mockImplementation(async ({ data }) => {
            persistedStatus = data.status;
            return { count: 1 };
          }),
        },
      };

      jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
        const snapshot = persistedStatus;
        try {
          return await callback(transactionClient);
        } catch (error) {
          persistedStatus = snapshot;
          throw error;
        }
      });
      jest.spyOn(auditService, 'createLogRequired').mockRejectedValueOnce(new Error('audit failed'));
      jest.spyOn(prisma.liquidation, 'findFirst').mockResolvedValueOnce(liquidation as never);

      await expect(
        service.cancelLiquidation(
          tenantId,
          'liq-1',
          membershipId
        ),
      ).rejects.toThrow('audit failed');

      expect(persistedStatus).toBe('DRAFT');
    });
  });

  describe('getLiquidationDetail', () => {
    it('debería retornar liquidación con expenses y charges', async () => {
      const liquidation = {
        id: 'liq-1',
        status: 'PUBLISHED',
        buildingId,
        period: '2026-04',
      };

      const expenses = [
        {
          id: 'exp-1',
          amountMinor: 100000,
          currencyCode: 'ARS',
          category: { name: 'Electricidad' },
          vendor: { name: 'EDENOR' },
        },
      ];

      const charges = [
        {
          unitId: 'unit-1',
          amount: 40000,
          unit: { code: 'A-101', label: '101', m2: 100 },
        },
        {
          unitId: 'unit-2',
          amount: 60000,
          unit: { code: 'A-102', label: '102', m2: 150 },
        },
      ];

      jest
        .spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValue(liquidation as never);
      jest.spyOn(prisma.expense, 'findMany').mockResolvedValue(expenses as never);
      jest.spyOn(prisma.charge, 'findMany').mockResolvedValue(charges as never);

      const result = await service.getLiquidationDetail(
        tenantId,
        'liq-1',
        membershipId,
      );

      expect(result.id).toBe('liq-1');
      expect(result.expenses.length).toBe(1);
      expect(result.chargesPreview.length).toBe(2);
    });

    it('debería retornar chargesPreview vacío si DRAFT', async () => {
      jest
        .spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValue({
          id: 'liq-1',
          status: 'DRAFT',
          buildingId,
          period: '2026-04',
        } as never);
      jest.spyOn(prisma.expense, 'findMany').mockResolvedValue([]);

      const result = await service.getLiquidationDetail(
        tenantId,
        'liq-1',
        membershipId,
      );

      expect(result.chargesPreview).toEqual([]);
    });

    it('debería rechazar detail si la membresía no existe o no pertenece al tenant', async () => {
      jest.spyOn(prisma.membership, 'findFirst').mockResolvedValueOnce(null);

      await expect(
        service.getLiquidationDetail(
          tenantId,
          'liq-1',
          'member-missing',
        ),
      ).rejects.toThrow('No se encontró una membresía válida para el tenant');
    });
  });
});
