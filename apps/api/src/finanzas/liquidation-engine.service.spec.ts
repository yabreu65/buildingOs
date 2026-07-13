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
  const adminRoles = ['TENANT_ADMIN'];

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
              delete: jest.fn(),
              deleteMany: jest.fn(),
            },
            charge: {
              createMany: jest.fn(),
              findMany: jest.fn(),
              deleteMany: jest.fn(),
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

      jest
        .spyOn(prisma.expense, 'findMany')
        .mockResolvedValueOnce(expenses as any)
        .mockResolvedValueOnce([]);
      jest.spyOn(prisma.unit, 'findMany').mockResolvedValue(units as any);
      jest.spyOn(prisma.liquidation, 'create').mockResolvedValue({
        id: 'liq-1',
        tenantId,
        buildingId,
        period: '2026-04',
        status: 'DRAFT',
        baseCurrency: 'ARS',
        totalAmountMinor: 150000,
        totalsByCurrency: { ARS: 150000 },
        unitCount: 2,
      } as any);

      const result = await service.createLiquidationDraft(
        tenantId,
        buildingId,
        '2026-04',
        'ARS',
        membershipId,
        adminRoles,
      );

      expect(result.liquidation.id).toBe('liq-1');
      expect(result.liquidation.status).toBe('DRAFT');
      expect(result.chargesPreview.length).toBe(2);
      expect(auditService.createLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LIQUIDATION_DRAFT',
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
          adminRoles,
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
        .mockResolvedValueOnce(expenses as any)
        .mockResolvedValueOnce([]);
      jest.spyOn(prisma.unit, 'findMany').mockResolvedValue([]);

      await expect(
        service.createLiquidationDraft(
          tenantId,
          buildingId,
          '2026-04',
          'ARS',
          membershipId,
          adminRoles,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debería prevenir acceso no-admin', async () => {
      jest
        .spyOn(validators, 'isAdminOrOperator')
        .mockReturnValue(false);

      await expect(
        service.createLiquidationDraft(
          tenantId,
          buildingId,
          '2026-04',
          'ARS',
          membershipId,
          ['RESIDENT'],
        ),
      ).rejects.toThrow('Solo administradores pueden crear liquidaciones');
    });
  });

  describe('reviewLiquidation', () => {
    it('debería cambiar estado DRAFT → REVIEWED', async () => {
      const liquidation = {
        id: 'liq-1',
        status: 'DRAFT',
        period: '2026-04',
      };

      jest
        .spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValue(liquidation as any);
      jest
        .spyOn(prisma.liquidation, 'update')
        .mockResolvedValue({ ...liquidation, status: 'REVIEWED' } as any);

      const result = await service.reviewLiquidation(
        tenantId,
        'liq-1',
        membershipId,
        adminRoles,
      );

      expect(result.status).toBe('REVIEWED');
      expect(auditService.createLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LIQUIDATION_REVIEW',
        }),
        prisma,
      );
    });

    it('debería lanzar error si liquidación no existe', async () => {
      jest.spyOn(prisma.liquidation, 'findFirst').mockResolvedValue(null);

      await expect(
        service.reviewLiquidation(
          tenantId,
          'liq-not-found',
          membershipId,
          adminRoles,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('debería lanzar error si status no es DRAFT', async () => {
      jest
        .spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValue({ id: 'liq-1', status: 'PUBLISHED' } as any);

      await expect(
        service.reviewLiquidation(
          tenantId,
          'liq-1',
          membershipId,
          adminRoles,
        ),
      ).rejects.toThrow(BadRequestException);
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

      jest
        .spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValue(liquidation as any);
      jest
        .spyOn(prisma.expense, 'findMany')
        .mockResolvedValueOnce(expenses as any)
        .mockResolvedValueOnce([]);
      jest.spyOn(prisma.unit, 'findMany').mockResolvedValue(units as any);
      jest
        .spyOn(prisma.charge, 'createMany')
        .mockResolvedValue({ count: 2 });
      jest
        .spyOn(prisma.liquidation, 'update')
        .mockResolvedValue({
          ...liquidation,
          status: 'PUBLISHED',
        } as any);

      const dueDate = new Date('2026-05-30');
      const result = await service.publishLiquidation(
        tenantId,
        'liq-1',
        dueDate,
        membershipId,
        adminRoles,
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
            publishedByMembershipId: membershipId,
          }),
        }),
      );
      expect(auditService.createLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LIQUIDATION_PUBLISH',
        }),
        prisma,
      );
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
          adminRoles,
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
        .mockResolvedValue({ id: 'liq-1', status: 'DRAFT' } as any);

      await expect(
        service.publishLiquidation(
          tenantId,
          'liq-1',
          new Date(),
          membershipId,
          adminRoles,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelLiquidation', () => {
    it('debería cambiar estado a CANCELED sin eliminar charges si DRAFT', async () => {
      jest
        .spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValue({ id: 'liq-1', status: 'DRAFT' } as any);
      jest.spyOn(prisma.liquidation, 'delete').mockResolvedValue({
        id: 'liq-1',
        status: 'DRAFT',
      } as any);

      await service.cancelLiquidation(
        tenantId,
        'liq-1',
        membershipId,
        adminRoles,
      );

      expect(prisma.charge.deleteMany).not.toHaveBeenCalled();
      expect(prisma.liquidation.delete).toHaveBeenCalledWith({
        where: { id: 'liq-1' },
      });
      expect(auditService.createLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LIQUIDATION_CANCEL' }),
        prisma,
      );
    });

    it('debería eliminar charges si status es PUBLISHED', async () => {
      jest
        .spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValue({ id: 'liq-1', status: 'PUBLISHED' } as any);
      jest.spyOn(prisma.liquidation, 'delete').mockResolvedValue({
        id: 'liq-1',
        status: 'PUBLISHED',
      } as any);

      await service.cancelLiquidation(
        tenantId,
        'liq-1',
        membershipId,
        adminRoles,
      );

      expect(prisma.charge.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, liquidationId: 'liq-1' },
        }),
      );
    });

    it('debería lanzar error si ya está CANCELED', async () => {
      jest
        .spyOn(prisma.liquidation, 'findFirst')
        .mockResolvedValue({ id: 'liq-1', status: 'CANCELED' } as any);

      await expect(
        service.cancelLiquidation(
          tenantId,
          'liq-1',
          membershipId,
          adminRoles,
        ),
      ).rejects.toThrow(BadRequestException);
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
        .mockResolvedValue(liquidation as any);
      jest.spyOn(prisma.expense, 'findMany').mockResolvedValue(expenses as any);
      jest.spyOn(prisma.charge, 'findMany').mockResolvedValue(charges as any);

      const result = await service.getLiquidationDetail(
        tenantId,
        'liq-1',
        adminRoles,
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
        } as any);
      jest.spyOn(prisma.expense, 'findMany').mockResolvedValue([]);

      const result = await service.getLiquidationDetail(
        tenantId,
        'liq-1',
        adminRoles,
      );

      expect(result.chargesPreview).toEqual([]);
    });
  });
});
