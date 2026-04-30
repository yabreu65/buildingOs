import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { MovementAllocationService } from './movement-allocation.service';

describe('MovementAllocationService', () => {
  let service: MovementAllocationService;
  let prisma: PrismaService;
  let auditService: AuditService;

  const tenantId = 'tenant-123';
  const membershipId = 'member-789';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MovementAllocationService,
        {
          provide: PrismaService,
          useValue: {
            building: { findMany: jest.fn() },
            movementAllocation: {
              create: jest.fn(),
              findMany: jest.fn(),
              deleteMany: jest.fn(),
            },
          },
        },
        {
          provide: AuditService,
          useValue: { createLog: jest.fn() },
        },
        {
          provide: FinanzasValidators,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<MovementAllocationService>(MovementAllocationService);
    prisma = module.get<PrismaService>(PrismaService);
    auditService = module.get<AuditService>(AuditService);
  });

  describe('validateAllocations', () => {
    it('debería validar allocations por porcentaje sumando 100%', async () => {
      const buildings = [
        { id: 'building-1', name: 'Edificio A' },
        { id: 'building-2', name: 'Edificio B' },
      ];
      jest.spyOn(prisma.building, 'findMany').mockResolvedValue(buildings as any);

      const allocations = [
        { buildingId: 'building-1', percentage: 60 },
        { buildingId: 'building-2', percentage: 40 },
      ];

      await expect(
        service.validateAllocations(
          tenantId,
          allocations,
          100000,
          'ARS',
        ),
      ).resolves.not.toThrow();
    });

    it('debería lanzar error si porcentajes no suman 100%', async () => {
      const buildings = [
        { id: 'building-1', name: 'Edificio A' },
        { id: 'building-2', name: 'Edificio B' },
      ];
      jest.spyOn(prisma.building, 'findMany').mockResolvedValue(buildings as any);

      const allocations = [
        { buildingId: 'building-1', percentage: 60 },
        { buildingId: 'building-2', percentage: 30 }, // suma 90, no 100
      ];

      await expect(
        service.validateAllocations(
          tenantId,
          allocations,
          100000,
          'ARS',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debería validar allocations por monto exacto', async () => {
      const buildings = [
        { id: 'building-1', name: 'Edificio A' },
        { id: 'building-2', name: 'Edificio B' },
      ];
      jest.spyOn(prisma.building, 'findMany').mockResolvedValue(buildings as any);

      const allocations = [
        { buildingId: 'building-1', amountMinor: 60000 },
        { buildingId: 'building-2', amountMinor: 40000 },
      ];

      await expect(
        service.validateAllocations(
          tenantId,
          allocations,
          100000,
          'ARS',
        ),
      ).resolves.not.toThrow();
    });

    it('debería lanzar error si montos no suman exacto', async () => {
      const buildings = [
        { id: 'building-1', name: 'Edificio A' },
        { id: 'building-2', name: 'Edificio B' },
      ];
      jest.spyOn(prisma.building, 'findMany').mockResolvedValue(buildings as any);

      const allocations = [
        { buildingId: 'building-1', amountMinor: 60000 },
        { buildingId: 'building-2', amountMinor: 30000 }, // suma 90000, no 100000
      ];

      await expect(
        service.validateAllocations(
          tenantId,
          allocations,
          100000,
          'ARS',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debería lanzar error si se mezclan % y montos', async () => {
      const buildings = [
        { id: 'building-1', name: 'Edificio A' },
        { id: 'building-2', name: 'Edificio B' },
      ];
      jest.spyOn(prisma.building, 'findMany').mockResolvedValue(buildings as any);

      const allocations = [
        { buildingId: 'building-1', percentage: 60 },
        { buildingId: 'building-2', amountMinor: 40000 }, // mezcla
      ];

      await expect(
        service.validateAllocations(
          tenantId,
          allocations,
          100000,
          'ARS',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debería lanzar error si buildingId no pertenece al tenant', async () => {
      jest.spyOn(prisma.building, 'findMany').mockResolvedValue([]);

      const allocations = [
        { buildingId: 'unknown-building', percentage: 100 },
      ];

      await expect(
        service.validateAllocations(
          tenantId,
          allocations,
          100000,
          'ARS',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debería lanzar error si hay duplicados de buildingId', async () => {
      const buildings = [
        { id: 'building-1', name: 'Edificio A' },
      ];
      jest.spyOn(prisma.building, 'findMany').mockResolvedValue(buildings as any);

      const allocations = [
        { buildingId: 'building-1', percentage: 50 },
        { buildingId: 'building-1', percentage: 50 }, // duplicado
      ];

      await expect(
        service.validateAllocations(
          tenantId,
          allocations,
          100000,
          'ARS',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createForExpense', () => {
    it('debería crear allocations para expense TENANT_SHARED', async () => {
      const allocations = [
        { buildingId: 'building-1', percentage: 60 },
        { buildingId: 'building-2', percentage: 40 },
      ];

      jest.spyOn(service, 'validateAllocations').mockResolvedValue(undefined);
      jest
        .spyOn(prisma.movementAllocation, 'create')
        .mockResolvedValue({ id: 'alloc-1' } as any);

      await service.createForExpense(
        tenantId,
        'exp-1',
        100000,
        'ARS',
        allocations,
        membershipId,
      );

      expect(prisma.movementAllocation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            expenseId: 'exp-1',
            percentage: 60,
          }),
        }),
      );
      expect(auditService.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'EXPENSE_ALLOCATION_CREATE',
        }),
      );
    });
  });

  describe('createForIncome', () => {
    it('debería crear allocations para income TENANT_SHARED', async () => {
      const allocations = [
        { buildingId: 'building-1', percentage: 50 },
        { buildingId: 'building-2', percentage: 50 },
      ];

      jest.spyOn(service, 'validateAllocations').mockResolvedValue(undefined);
      jest
        .spyOn(prisma.movementAllocation, 'create')
        .mockResolvedValue({ id: 'alloc-1' } as any);

      await service.createForIncome(
        tenantId,
        'inc-1',
        200000,
        'ARS',
        allocations,
        membershipId,
      );

      expect(prisma.movementAllocation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            incomeId: 'inc-1',
            percentage: 50,
          }),
        }),
      );
      expect(auditService.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'INCOME_ALLOCATION_CREATE',
        }),
      );
    });
  });

  describe('getAllocations', () => {
    it('debería obtener allocations por expenseId', async () => {
      const allocations = [
        {
          id: 'alloc-1',
          expenseId: 'exp-1',
          buildingId: 'building-1',
          percentage: 60,
          building: { id: 'building-1', name: 'Edificio A' },
        },
      ];

      jest
        .spyOn(prisma.movementAllocation, 'findMany')
        .mockResolvedValue(allocations as any);

      const result = await service.getAllocations(
        tenantId,
        'exp-1',
        undefined,
      );

      expect(result.length).toBe(1);
      expect(result[0].expenseId).toBe('exp-1');
      expect(prisma.movementAllocation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            expenseId: 'exp-1',
          }),
        }),
      );
    });

    it('debería obtener allocations por incomeId', async () => {
      const allocations = [
        {
          id: 'alloc-2',
          incomeId: 'inc-1',
          buildingId: 'building-2',
          percentage: 50,
          building: { id: 'building-2', name: 'Edificio B' },
        },
      ];

      jest
        .spyOn(prisma.movementAllocation, 'findMany')
        .mockResolvedValue(allocations as any);

      const result = await service.getAllocations(
        tenantId,
        undefined,
        'inc-1',
      );

      expect(result.length).toBe(1);
      expect(result[0].incomeId).toBe('inc-1');
    });
  });

  describe('deleteForMovement', () => {
    it('debería eliminar allocations para expense', async () => {
      jest
        .spyOn(prisma.movementAllocation, 'deleteMany')
        .mockResolvedValue({ count: 2 });

      await service.deleteForMovement(tenantId, 'exp-1', undefined);

      expect(prisma.movementAllocation.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            expenseId: 'exp-1',
          }),
        }),
      );
    });

    it('debería eliminar allocations para income', async () => {
      jest
        .spyOn(prisma.movementAllocation, 'deleteMany')
        .mockResolvedValue({ count: 2 });

      await service.deleteForMovement(tenantId, undefined, 'inc-1');

      expect(prisma.movementAllocation.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            incomeId: 'inc-1',
          }),
        }),
      );
    });
  });
});
