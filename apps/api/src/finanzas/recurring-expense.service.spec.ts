import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MovementAllocationService } from './movement-allocation.service';
import { RecurringExpenseService } from './recurring-expense.service';
import {
  CreateRecurringExpenseDto,
  UpdateRecurringExpenseDto,
} from './recurring-expense.dto';

describe('RecurringExpenseService', () => {
  let service: RecurringExpenseService;
  let prisma: PrismaService;
  let auditService: AuditService;
  let movementAllocationService: MovementAllocationService;
  let tx: Record<string, any>;
  let loggerErrorSpy: jest.SpyInstance;

  const tenantId = 'tenant-1';
  const buildingId = 'building-1';
  const recurringId = 'recurring-1';
  const categoryId = 'category-1';

  const baseCreateDto: CreateRecurringExpenseDto = {
    categoryId,
    amount: 10000,
    currency: 'ARS',
    concept: 'Expensas mensuales',
    frequency: 'MONTHLY',
  };

  const makeRecurring = (overrides: Record<string, unknown> = {}) => ({
    id: recurringId,
    tenantId,
    buildingId: null,
    scopeType: 'BUILDING',
    allocationMode: null,
    categoryId,
    amount: 10000,
    currency: 'ARS',
    concept: 'Expensas mensuales',
    frequency: 'MONTHLY',
    nextRunDate: new Date('2026-09-01'),
    isActive: true,
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    allocations: [],
    ...overrides,
  });

  const makeCategory = (catalogScope: string) => ({
    id: categoryId,
    tenantId,
    name: 'Rubro',
    catalogScope,
    isActive: true,
  });

  beforeEach(async () => {
    tx = {
      recurringExpense: {
        create: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
      },
      recurringExpenseAllocation: {
        createMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      expense: {
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringExpenseService,
        {
          provide: PrismaService,
          useValue: {
            recurringExpense: {
              findFirst: jest.fn(),
              findMany: jest.fn(),
              create: jest.fn(),
              updateMany: jest.fn(),
            },
            recurringExpenseAllocation: {
              createMany: jest.fn(),
              deleteMany: jest.fn(),
            },
            expenseLedgerCategory: {
              findFirst: jest.fn(),
            },
            building: {
              findFirst: jest.fn(),
              findMany: jest.fn(),
            },
            expense: {
              create: jest.fn(),
            },
            $transaction: jest.fn((callback: (client: Record<string, any>) => Promise<unknown>) =>
              callback(tx),
            ),
          },
        },
        {
          provide: AuditService,
          useValue: { createLog: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: MovementAllocationService,
          useValue: {
            validateAllocations: jest.fn().mockResolvedValue(undefined),
            suggestAllocationsByMode: jest.fn(),
            createForExpenseInTx: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<RecurringExpenseService>(RecurringExpenseService);
    prisma = module.get<PrismaService>(PrismaService);
    auditService = module.get<AuditService>(AuditService);
    movementAllocationService = module.get<MovementAllocationService>(MovementAllocationService);

    jest.spyOn(prisma.building, 'findFirst').mockResolvedValue({
      id: buildingId,
      tenantId,
    } as any);
    jest.spyOn(prisma.expenseLedgerCategory, 'findFirst').mockResolvedValue(
      makeCategory('BUILDING') as any,
    );
    jest.spyOn(prisma.recurringExpense, 'create').mockResolvedValue(
      makeRecurring({ buildingId, scopeType: 'BUILDING' }) as any,
    );
    (prisma.$transaction as jest.Mock).mockImplementation(
      (callback: (client: Record<string, any>) => Promise<unknown>) => callback(tx),
    );

    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    loggerErrorSpy.mockRestore();
  });

  // ========== CREATE — BUILDING ==========
  describe('createRecurringExpense — BUILDING', () => {
    it('crea RecurringExpense BUILDING con scopeType omitido, buildingId de la ruta, allocationMode null y sin template allocations', async () => {
      const result = await service.createRecurringExpense(tenantId, baseCreateDto, buildingId);

      expect(prisma.building.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: buildingId, tenantId } }),
      );
      expect(prisma.recurringExpense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            buildingId,
            scopeType: 'BUILDING',
            allocationMode: null,
          }),
        }),
      );
      expect(prisma.recurringExpenseAllocation.createMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(result.scopeType).toBe('BUILDING');
    });

    it('acepta scopeType BUILDING explícito', async () => {
      const dto = { ...baseCreateDto, scopeType: 'BUILDING' as const };
      await service.createRecurringExpense(tenantId, dto, buildingId);

      expect(prisma.recurringExpense.create).toHaveBeenCalled();
    });

    it('rechaza con 400 scopeType TENANT_SHARED en ruta building y no crea RecurringExpense', async () => {
      const dto = { ...baseCreateDto, scopeType: 'TENANT_SHARED' as const };

      await expect(service.createRecurringExpense(tenantId, dto, buildingId)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.recurringExpense.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rechaza con 400 allocationMode en scope BUILDING', async () => {
      const dto = { ...baseCreateDto, allocationMode: 'MANUAL' as const };

      await expect(service.createRecurringExpense(tenantId, dto, buildingId)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.recurringExpense.create).not.toHaveBeenCalled();
    });

    it('rechaza con 400 allocations en scope BUILDING', async () => {
      const dto = {
        ...baseCreateDto,
        allocations: [{ buildingId: 'b-9', percentage: 100 }],
      };

      await expect(service.createRecurringExpense(tenantId, dto, buildingId)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.recurringExpense.create).not.toHaveBeenCalled();
    });

    it('rechaza building que no pertenece al tenant y no crea RecurringExpense', async () => {
      jest.spyOn(prisma.building, 'findFirst').mockResolvedValue(null);

      await expect(service.createRecurringExpense(tenantId, baseCreateDto, buildingId)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.recurringExpense.create).not.toHaveBeenCalled();
    });

    it('rechaza con 422 CATEGORY_SCOPE_MISMATCH rubro CONDOMINIUM_COMMON en BUILDING', async () => {
      jest.spyOn(prisma.expenseLedgerCategory, 'findFirst').mockResolvedValue(
        makeCategory('CONDOMINIUM_COMMON') as any,
      );

      const error = await service
        .createRecurringExpense(tenantId, baseCreateDto, buildingId)
        .catch((e: UnprocessableEntityException) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as any)?.getResponse?.()).toEqual(
        expect.objectContaining({ error: 'CATEGORY_SCOPE_MISMATCH' }),
      );
      expect(prisma.recurringExpense.create).not.toHaveBeenCalled();
    });

    it('audit de create BUILDING NO incluye la propiedad allocationMode', async () => {
      await service.createRecurringExpense(tenantId, baseCreateDto, buildingId);

      expect(auditService.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.not.objectContaining({ allocationMode: expect.anything() }),
        }),
      );
      const metadata = (auditService.createLog as jest.Mock).mock.calls[0][0].metadata;
      expect(metadata).not.toHaveProperty('allocationMode');
    });
  });

  // ========== CREATE — TENANT_SHARED MANUAL ==========
  describe('createRecurringExpense — TENANT_SHARED MANUAL', () => {
    const manualDto: CreateRecurringExpenseDto = {
      ...baseCreateDto,
      scopeType: 'TENANT_SHARED',
      allocationMode: 'MANUAL',
      allocations: [
        { buildingId: 'building-1', percentage: 60 },
        { buildingId: 'building-2', percentage: 40 },
      ],
    };

    beforeEach(() => {
      jest.spyOn(prisma.expenseLedgerCategory, 'findFirst').mockResolvedValue(
        makeCategory('CONDOMINIUM_COMMON') as any,
      );
      tx.recurringExpense.create.mockResolvedValue(
        makeRecurring({ scopeType: 'TENANT_SHARED', allocationMode: 'MANUAL' }),
      );
      tx.recurringExpenseAllocation.createMany.mockResolvedValue({ count: 2 });
    });

    it('crea RecurringExpense + RecurringExpenseAllocation[] dentro de la misma $transaction, validando vía validateAllocations', async () => {
      const result = await service.createRecurringExpense(tenantId, manualDto);

      expect(movementAllocationService.validateAllocations).toHaveBeenCalledWith(
        tenantId,
        manualDto.allocations,
        manualDto.amount,
        manualDto.currency,
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.recurringExpense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            buildingId: null,
            scopeType: 'TENANT_SHARED',
            allocationMode: 'MANUAL',
          }),
        }),
      );
      expect(tx.recurringExpenseAllocation.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              tenantId,
              recurringExpenseId: recurringId,
              buildingId: 'building-1',
              percentage: 60,
            }),
            expect.objectContaining({
              tenantId,
              recurringExpenseId: recurringId,
              buildingId: 'building-2',
              percentage: 40,
            }),
          ]),
        }),
      );
      expect(result.scopeType).toBe('TENANT_SHARED');
    });

    it('rechaza con 400 MANUAL sin allocations', async () => {
      const dto = { ...baseCreateDto, scopeType: 'TENANT_SHARED' as const, allocationMode: 'MANUAL' as const };

      await expect(service.createRecurringExpense(tenantId, dto)).rejects.toThrow(BadRequestException);
      expect(movementAllocationService.validateAllocations).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('propaga error de validateAllocations sin abrir mutación parcial', async () => {
      (movementAllocationService.validateAllocations as jest.Mock).mockRejectedValueOnce(
        new BadRequestException('Los porcentajes deben sumar 100%'),
      );

      await expect(service.createRecurringExpense(tenantId, manualDto)).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.recurringExpense.create).not.toHaveBeenCalled();
    });

    it('rechaza con 422 CATEGORY_SCOPE_MISMATCH rubro BUILDING para TENANT_SHARED', async () => {
      jest.spyOn(prisma.expenseLedgerCategory, 'findFirst').mockResolvedValue(
        makeCategory('BUILDING') as any,
      );

      const error = await service
        .createRecurringExpense(tenantId, manualDto)
        .catch((e: UnprocessableEntityException) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as any)?.getResponse?.()).toEqual(
        expect.objectContaining({ error: 'CATEGORY_SCOPE_MISMATCH' }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('no considera la regla creada si falla createMany de templates', async () => {
      tx.recurringExpenseAllocation.createMany.mockRejectedValueOnce(new Error('createMany failed'));

      await expect(service.createRecurringExpense(tenantId, manualDto)).rejects.toThrow('createMany failed');
      expect(auditService.createLog).not.toHaveBeenCalled();
    });

    it('dispara el audit solo después de resolver correctamente la transacción', async () => {
      await service.createRecurringExpense(tenantId, manualDto);

      const txCallOrder = (prisma.$transaction as jest.Mock).mock.invocationCallOrder[0];
      const auditCallOrder = (auditService.createLog as jest.Mock).mock.invocationCallOrder[0];

      expect(auditService.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          action: 'EXPENSE_CREATE',
          entityType: 'RecurringExpense',
          entityId: recurringId,
        }),
      );
      expect(txCallOrder).toBeLessThan(auditCallOrder);
    });

    it('audit de create TENANT_SHARED MANUAL incluye allocationMode MANUAL', async () => {
      await service.createRecurringExpense(tenantId, manualDto);

      const metadata = (auditService.createLog as jest.Mock).mock.calls[0][0].metadata;
      expect(metadata).toHaveProperty('allocationMode', 'MANUAL');
    });
  });

  // ========== CREATE — MODOS DINÁMICOS ==========
  describe('createRecurringExpense — EQUAL_SHARE / BUILDING_TOTAL_M2', () => {
    beforeEach(() => {
      jest.spyOn(prisma.expenseLedgerCategory, 'findFirst').mockResolvedValue(
        makeCategory('CONDOMINIUM_COMMON') as any,
      );
      jest.spyOn(prisma.recurringExpense, 'create').mockResolvedValue(
        makeRecurring({ scopeType: 'TENANT_SHARED', allocationMode: 'EQUAL_SHARE' }) as any,
      );
    });

    it('EQUAL_SHARE válido sin allocations: crea regla sin persistir templates', async () => {
      const dto: CreateRecurringExpenseDto = {
        ...baseCreateDto,
        scopeType: 'TENANT_SHARED',
        allocationMode: 'EQUAL_SHARE',
      };

      const result = await service.createRecurringExpense(tenantId, dto);

      expect(prisma.recurringExpense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scopeType: 'TENANT_SHARED',
            allocationMode: 'EQUAL_SHARE',
            buildingId: null,
          }),
        }),
      );
      expect(prisma.recurringExpenseAllocation.createMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(result.scopeType).toBe('TENANT_SHARED');
    });

    it('BUILDING_TOTAL_M2 válido sin allocations: crea regla sin persistir templates', async () => {
      jest.spyOn(prisma.recurringExpense, 'create').mockResolvedValue(
        makeRecurring({ scopeType: 'TENANT_SHARED', allocationMode: 'BUILDING_TOTAL_M2' }) as any,
      );
      const dto: CreateRecurringExpenseDto = {
        ...baseCreateDto,
        scopeType: 'TENANT_SHARED',
        allocationMode: 'BUILDING_TOTAL_M2',
      };

      const result = await service.createRecurringExpense(tenantId, dto);

      expect(prisma.recurringExpense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            allocationMode: 'BUILDING_TOTAL_M2',
          }),
        }),
      );
      expect(prisma.recurringExpenseAllocation.createMany).not.toHaveBeenCalled();
      expect(result.allocationMode).toBe('BUILDING_TOTAL_M2');
    });

    it('rechaza con 400 EQUAL_SHARE con allocations manuales', async () => {
      const dto: CreateRecurringExpenseDto = {
        ...baseCreateDto,
        scopeType: 'TENANT_SHARED',
        allocationMode: 'EQUAL_SHARE',
        allocations: [{ buildingId: 'b-1', percentage: 100 }],
      };

      await expect(service.createRecurringExpense(tenantId, dto)).rejects.toThrow(BadRequestException);
      expect(prisma.recurringExpense.create).not.toHaveBeenCalled();
    });

    it('rechaza con 400 BUILDING_TOTAL_M2 con allocations', async () => {
      const dto: CreateRecurringExpenseDto = {
        ...baseCreateDto,
        scopeType: 'TENANT_SHARED',
        allocationMode: 'BUILDING_TOTAL_M2',
        allocations: [{ buildingId: 'b-1', percentage: 100 }],
      };

      await expect(service.createRecurringExpense(tenantId, dto)).rejects.toThrow(BadRequestException);
      expect(prisma.recurringExpense.create).not.toHaveBeenCalled();
    });

    it('rechaza con 400 ruta tenant con scopeType BUILDING, sin reinterpretar', async () => {
      const dto = { ...baseCreateDto, scopeType: 'BUILDING' as const };

      await expect(service.createRecurringExpense(tenantId, dto)).rejects.toThrow(BadRequestException);
      expect(prisma.expenseLedgerCategory.findFirst).not.toHaveBeenCalled();
      expect(prisma.recurringExpense.create).not.toHaveBeenCalled();
    });
  });

  // ========== LIST ==========
  describe('listRecurringExpenses', () => {
    beforeEach(() => {
      jest.spyOn(prisma.recurringExpense, 'findMany').mockResolvedValue([] as any);
    });

    it('lista BUILDING filtrando tenantId, buildingId y scopeType', async () => {
      await service.listRecurringExpenses(tenantId, buildingId, false, 'BUILDING');

      expect(prisma.recurringExpense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId,
            isActive: true,
            scopeType: 'BUILDING',
            buildingId,
          },
          orderBy: { nextRunDate: 'asc' },
        }),
      );
    });

    it('lista tenant/shared con buildingId null y scope TENANT_SHARED', async () => {
      await service.listRecurringExpenses(tenantId, undefined, false, 'TENANT_SHARED');

      expect(prisma.recurringExpense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId,
            isActive: true,
            scopeType: 'TENANT_SHARED',
            buildingId: null,
          },
        }),
      );
    });

    it('includeInactive true omite el filtro isActive', async () => {
      await service.listRecurringExpenses(tenantId, undefined, true, 'TENANT_SHARED');

      expect(prisma.recurringExpense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ isActive: true }),
        }),
      );
    });
  });

  // ========== PATCH — BUILDING ==========
  describe('updateRecurringExpense — BUILDING', () => {
    const expectedScope = { scopeType: 'BUILDING' as const, buildingId };

    beforeEach(() => {
      jest.spyOn(prisma.recurringExpense, 'findFirst').mockResolvedValue(
        makeRecurring({ buildingId, scopeType: 'BUILDING' }) as any,
      );
      jest.spyOn(prisma.recurringExpense, 'updateMany').mockResolvedValue({ count: 1 } as any);
    });

    it('actualiza amount/concept/isActive válido de forma tenant-scoped', async () => {
      (prisma.recurringExpense.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeRecurring({ buildingId, scopeType: 'BUILDING' }))
        .mockResolvedValueOnce(makeRecurring({ buildingId, scopeType: 'BUILDING', amount: 7500 }));

      const result = await service.updateRecurringExpense(tenantId, recurringId, {
        amount: 7500,
        concept: 'Nuevo concepto',
        isActive: false,
      }, expectedScope);

      expect(prisma.recurringExpense.findFirst).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ where: { id: recurringId, tenantId, scopeType: 'BUILDING', buildingId } }),
      );
      expect(prisma.recurringExpense.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: recurringId, tenantId },
          data: expect.objectContaining({ amount: 7500, concept: 'Nuevo concepto', isActive: false }),
        }),
      );
      expect(result.amount).toBe(7500);
    });

    it('rechaza con 400 allocationMode en BUILDING', async () => {
      await expect(
        service.updateRecurringExpense(tenantId, recurringId, { allocationMode: 'MANUAL' }, expectedScope),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.recurringExpense.updateMany).not.toHaveBeenCalled();
    });

    it('rechaza con 400 allocations en BUILDING', async () => {
      await expect(
        service.updateRecurringExpense(tenantId, recurringId, {
          allocations: [{ buildingId: 'b-1', percentage: 100 }],
        }, expectedScope),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.recurringExpense.updateMany).not.toHaveBeenCalled();
    });

    it('lanza NotFound para recurringId de otro tenant sin mutación', async () => {
      jest.spyOn(prisma.recurringExpense, 'findFirst').mockResolvedValue(null);

      await expect(
        service.updateRecurringExpense(tenantId, 'recurring-other', { amount: 1 }, expectedScope),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.recurringExpense.updateMany).not.toHaveBeenCalled();
    });

    it('regla BUILDING de otro edificio: NotFound porque el where exige buildingId de la ruta', async () => {
      // Simula que la regla existe pero pertenece a building-2: el findFirst
      // con buildingId de la ruta (building-1) no la encuentra.
      jest.spyOn(prisma.recurringExpense, 'findFirst').mockResolvedValue(null);

      await expect(
        service.updateRecurringExpense(tenantId, recurringId, { amount: 1 }, expectedScope),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.recurringExpense.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: recurringId, tenantId, scopeType: 'BUILDING', buildingId },
        }),
      );
      expect(prisma.recurringExpense.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ========== PATCH — TENANT_SHARED MANUAL ==========
  describe('updateRecurringExpense — TENANT_SHARED MANUAL', () => {
    const expectedScope = { scopeType: 'TENANT_SHARED' as const, buildingId: null };
    const manualExisting = (overrides: Record<string, unknown> = {}) =>
      makeRecurring({
        scopeType: 'TENANT_SHARED',
        allocationMode: 'MANUAL',
        allocations: [
          { id: 'a1', recurringExpenseId: recurringId, tenantId, buildingId: 'building-1', percentage: 60, createdAt: new Date(), updatedAt: new Date() },
          { id: 'a2', recurringExpenseId: recurringId, tenantId, buildingId: 'building-2', percentage: 40, createdAt: new Date(), updatedAt: new Date() },
        ],
        ...overrides,
      });

    beforeEach(() => {
      jest.spyOn(prisma.recurringExpense, 'findFirst').mockResolvedValue(manualExisting() as any);
      jest.spyOn(prisma.recurringExpense, 'updateMany').mockResolvedValue({ count: 1 } as any);
      tx.recurringExpenseAllocation.deleteMany.mockResolvedValue({ count: 2 });
      tx.recurringExpenseAllocation.createMany.mockResolvedValue({ count: 2 });
      tx.recurringExpense.updateMany.mockResolvedValue({ count: 1 });
      tx.recurringExpense.findFirst.mockResolvedValue(manualExisting());
    });

    it('reemplazo MANUAL válido: validateAllocations ANTES de deleteMany, delete+create+update en transacción', async () => {
      const newAllocations = [
        { buildingId: 'building-1', percentage: 70 },
        { buildingId: 'building-3', percentage: 30 },
      ];
      tx.recurringExpense.findFirst.mockResolvedValue(
        manualExisting({ allocations: newAllocations }),
      );

      await service.updateRecurringExpense(tenantId, recurringId, { allocations: newAllocations }, expectedScope);

      const validateOrder = (movementAllocationService.validateAllocations as jest.Mock).mock.invocationCallOrder[0];
      const deleteOrder = (tx.recurringExpenseAllocation.deleteMany as jest.Mock).mock.invocationCallOrder[0];
      const createOrder = (tx.recurringExpenseAllocation.createMany as jest.Mock).mock.invocationCallOrder[0];

      expect(movementAllocationService.validateAllocations).toHaveBeenCalledWith(
        tenantId,
        newAllocations,
        10000,
        'ARS',
      );
      expect(validateOrder).toBeLessThan(deleteOrder);
      expect(deleteOrder).toBeLessThan(createOrder);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.recurringExpenseAllocation.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { recurringExpenseId: recurringId, tenantId } }),
      );
      expect(tx.recurringExpense.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: recurringId, tenantId } }),
      );
    });

    it('si validateAllocations falla, no ejecuta deleteMany ni createMany', async () => {
      (movementAllocationService.validateAllocations as jest.Mock).mockRejectedValueOnce(
        new BadRequestException('invalid'),
      );

      await expect(
        service.updateRecurringExpense(tenantId, recurringId, {
          allocations: [{ buildingId: 'building-1', percentage: 50 }],
        }, expectedScope),
      ).rejects.toThrow(BadRequestException);

      expect(tx.recurringExpenseAllocation.deleteMany).not.toHaveBeenCalled();
      expect(tx.recurringExpenseAllocation.createMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('si createMany falla dentro de transacción, la operación es rechazada sin retorno de éxito', async () => {
      tx.recurringExpenseAllocation.createMany.mockRejectedValueOnce(new Error('createMany failed'));

      await expect(
        service.updateRecurringExpense(tenantId, recurringId, {
          allocations: [{ buildingId: 'building-1', percentage: 100 }],
        }, expectedScope),
      ).rejects.toThrow('createMany failed');
    });

    it('cambio EQUAL_SHARE -> MANUAL exige allocations, valida y crea templates', async () => {
      const existing = makeRecurring({
        scopeType: 'TENANT_SHARED',
        allocationMode: 'EQUAL_SHARE',
        allocations: [],
      });
      (prisma.recurringExpense.findFirst as jest.Mock).mockResolvedValueOnce(existing);
      tx.recurringExpense.findFirst.mockResolvedValue(
        makeRecurring({ scopeType: 'TENANT_SHARED', allocationMode: 'MANUAL' }),
      );
      const newAllocations = [
        { buildingId: 'building-1', percentage: 60 },
        { buildingId: 'building-2', percentage: 40 },
      ];

      const result = await service.updateRecurringExpense(tenantId, recurringId, {
        allocationMode: 'MANUAL',
        allocations: newAllocations,
      }, expectedScope);

      expect(movementAllocationService.validateAllocations).toHaveBeenCalled();
      expect(tx.recurringExpenseAllocation.deleteMany).toHaveBeenCalled();
      expect(tx.recurringExpenseAllocation.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ buildingId: 'building-1', percentage: 60 }),
            expect.objectContaining({ buildingId: 'building-2', percentage: 40 }),
          ]),
        }),
      );
      expect(result.allocationMode).toBe('MANUAL');
    });

    it('cambio MANUAL -> EQUAL_SHARE elimina templates en transacción y cambia allocationMode', async () => {
      const existing = manualExisting();
      (prisma.recurringExpense.findFirst as jest.Mock).mockResolvedValueOnce(existing);
      tx.recurringExpense.findFirst.mockResolvedValue(
        makeRecurring({ scopeType: 'TENANT_SHARED', allocationMode: 'EQUAL_SHARE', allocations: [] }),
      );

      const result = await service.updateRecurringExpense(tenantId, recurringId, {
        allocationMode: 'EQUAL_SHARE',
      }, expectedScope);

      expect(tx.recurringExpenseAllocation.deleteMany).toHaveBeenCalled();
      expect(tx.recurringExpenseAllocation.createMany).not.toHaveBeenCalled();
      expect(tx.recurringExpense.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: recurringId, tenantId },
          data: expect.objectContaining({ allocationMode: 'EQUAL_SHARE' }),
        }),
      );
      expect(result.allocationMode).toBe('EQUAL_SHARE');
    });

    it('cambio MANUAL -> BUILDING_TOTAL_M2 elimina templates en transacción', async () => {
      const existing = manualExisting();
      (prisma.recurringExpense.findFirst as jest.Mock).mockResolvedValueOnce(existing);
      tx.recurringExpense.findFirst.mockResolvedValue(
        makeRecurring({ scopeType: 'TENANT_SHARED', allocationMode: 'BUILDING_TOTAL_M2', allocations: [] }),
      );

      const result = await service.updateRecurringExpense(tenantId, recurringId, {
        allocationMode: 'BUILDING_TOTAL_M2',
      }, expectedScope);

      expect(tx.recurringExpenseAllocation.deleteMany).toHaveBeenCalled();
      expect(tx.recurringExpense.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ allocationMode: 'BUILDING_TOTAL_M2' }) }),
      );
      expect(result.allocationMode).toBe('BUILDING_TOTAL_M2');
    });

    it('rechaza con 400 cambio a MANUAL sin allocations', async () => {
      const existing = makeRecurring({
        scopeType: 'TENANT_SHARED',
        allocationMode: 'EQUAL_SHARE',
        allocations: [],
      });
      (prisma.recurringExpense.findFirst as jest.Mock).mockResolvedValueOnce(existing);

      const error = await service
        .updateRecurringExpense(tenantId, recurringId, { allocationMode: 'MANUAL' }, expectedScope)
        .catch((e: Error) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(tx.recurringExpenseAllocation.deleteMany).not.toHaveBeenCalled();
      expect(tx.recurringExpenseAllocation.createMany).not.toHaveBeenCalled();
    });

    it('rechaza con 400 cambio BUILDING_TOTAL_M2 -> MANUAL sin allocations', async () => {
      const existing = makeRecurring({
        scopeType: 'TENANT_SHARED',
        allocationMode: 'BUILDING_TOTAL_M2',
        allocations: [],
      });
      (prisma.recurringExpense.findFirst as jest.Mock).mockResolvedValueOnce(existing);

      const error = await service
        .updateRecurringExpense(tenantId, recurringId, { allocationMode: 'MANUAL' }, expectedScope)
        .catch((e: Error) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(prisma.recurringExpense.updateMany).not.toHaveBeenCalled();
      expect(tx.recurringExpenseAllocation.deleteMany).not.toHaveBeenCalled();
      expect(tx.recurringExpenseAllocation.createMany).not.toHaveBeenCalled();
    });

    it('MANUAL existente con templates + update amount sin allocations: válido y conserva templates', async () => {
      const existing = manualExisting();
      (prisma.recurringExpense.findFirst as jest.Mock)
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(manualExisting({ amount: 12500 }));

      const result = await service.updateRecurringExpense(tenantId, recurringId, {
        amount: 12500,
      }, expectedScope);

      expect(prisma.recurringExpense.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: recurringId, tenantId },
          data: expect.objectContaining({ amount: 12500 }),
        }),
      );
      expect(tx.recurringExpenseAllocation.deleteMany).not.toHaveBeenCalled();
      expect(tx.recurringExpenseAllocation.createMany).not.toHaveBeenCalled();
      expect(result.amount).toBe(12500);
      expect(result.allocationMode).toBe('MANUAL');
    });

    it('MANUAL -> MANUAL con allocations nuevas: reemplazo válido y atómico', async () => {
      const existing = manualExisting();
      (prisma.recurringExpense.findFirst as jest.Mock).mockResolvedValueOnce(existing);
      tx.recurringExpense.findFirst.mockResolvedValue(
        manualExisting({ allocations: [
          { id: 'a9', recurringExpenseId: recurringId, tenantId, buildingId: 'building-1', percentage: 100, createdAt: new Date(), updatedAt: new Date() },
        ] }),
      );
      const newAllocations = [{ buildingId: 'building-1', percentage: 100 }];

      const result = await service.updateRecurringExpense(tenantId, recurringId, {
        allocationMode: 'MANUAL',
        allocations: newAllocations,
      }, expectedScope);

      expect(movementAllocationService.validateAllocations).toHaveBeenCalledWith(
        tenantId,
        newAllocations,
        10000,
        'ARS',
      );
      expect(tx.recurringExpenseAllocation.deleteMany).toHaveBeenCalled();
      expect(tx.recurringExpenseAllocation.createMany).toHaveBeenCalled();
      expect(tx.recurringExpense.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: recurringId, tenantId } }),
      );
      expect(result.allocationMode).toBe('MANUAL');
    });

    it('rechaza con 400 cambio a MANUAL con allocations vacías', async () => {
      const existing = makeRecurring({
        scopeType: 'TENANT_SHARED',
        allocationMode: 'EQUAL_SHARE',
        allocations: [],
      });
      (prisma.recurringExpense.findFirst as jest.Mock).mockResolvedValueOnce(existing);
      (movementAllocationService.validateAllocations as jest.Mock).mockRejectedValueOnce(
        new BadRequestException('Las allocations no pueden estar vacías'),
      );

      const error = await service
        .updateRecurringExpense(tenantId, recurringId, { allocationMode: 'MANUAL', allocations: [] }, expectedScope)
        .catch((e: Error) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(tx.recurringExpenseAllocation.deleteMany).not.toHaveBeenCalled();
      expect(tx.recurringExpenseAllocation.createMany).not.toHaveBeenCalled();
    });

    it('comprueba explícitamente que updateMany contiene id + tenantId en where', async () => {
      await service.updateRecurringExpense(tenantId, recurringId, { amount: 500 }, expectedScope);

      expect(prisma.recurringExpense.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: recurringId, tenantId },
        }),
      );
    });

    it('lanza NotFound cuando updateMany retorna count=0', async () => {
      (prisma.recurringExpense.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });

      await expect(
        service.updateRecurringExpense(tenantId, recurringId, { amount: 500 }, expectedScope),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ========== CRON — BUILDING ==========
  describe('processRecurringExpenses — BUILDING', () => {
    const buildingRule = () =>
      makeRecurring({
        id: 're-b1',
        buildingId,
        scopeType: 'BUILDING',
        allocationMode: null,
        nextRunDate: new Date('2020-01-01'),
      });

    beforeEach(() => {
      tx.expense.create.mockResolvedValue({
        id: 'expense-1',
        tenantId,
        buildingId,
        scopeType: 'BUILDING',
      });
      tx.recurringExpense.updateMany.mockResolvedValue({ count: 1 });
    });

    it('regla BUILDING due válida: crea Expense BUILDING DRAFT, update nextRunDate tenant-scoped, createdCount=1', async () => {
      jest.spyOn(prisma.recurringExpense, 'findMany').mockResolvedValue([buildingRule()] as any);

      const result = await service.processRecurringExpenses();

      expect(tx.expense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            buildingId,
            scopeType: 'BUILDING',
            status: 'DRAFT',
            amountMinor: 10000,
            currencyCode: 'ARS',
          }),
        }),
      );
      expect(tx.recurringExpense.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 're-b1', tenantId },
          data: expect.objectContaining({ nextRunDate: expect.any(Date) }),
        }),
      );
      expect(result.createdCount).toBe(1);
    });

    it('BUILDING sin buildingId: falla la regla sin Expense ni nextRunDate, y no incrementa createdCount', async () => {
      const rule = buildingRule();
      rule.buildingId = null;
      jest.spyOn(prisma.recurringExpense, 'findMany').mockResolvedValue([rule] as any);

      const result = await service.processRecurringExpenses();

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(result.createdCount).toBe(0);
      expect(loggerErrorSpy).toHaveBeenCalled();
    });

    it('fallo en expense.create: sin nextRunDate ni audit exitoso', async () => {
      jest.spyOn(prisma.recurringExpense, 'findMany').mockResolvedValue([buildingRule()] as any);
      tx.expense.create.mockRejectedValueOnce(new Error('expense create failed'));

      const result = await service.processRecurringExpenses();

      expect(tx.recurringExpense.updateMany).not.toHaveBeenCalled();
      expect(auditService.createLog).not.toHaveBeenCalled();
      expect(result.createdCount).toBe(0);
    });

    it('fallo en updateMany: transacción falla, sin audit, createdCount no incrementa', async () => {
      jest.spyOn(prisma.recurringExpense, 'findMany').mockResolvedValue([buildingRule()] as any);
      tx.recurringExpense.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await service.processRecurringExpenses();

      expect(auditService.createLog).not.toHaveBeenCalled();
      expect(result.createdCount).toBe(0);
    });

    it('audit post-transacción: entityType Expense, entityId = expense.id, recurringId en metadata', async () => {
      jest.spyOn(prisma.recurringExpense, 'findMany').mockResolvedValue([buildingRule()] as any);

      await service.processRecurringExpenses();

      const txCallOrder = (prisma.$transaction as jest.Mock).mock.invocationCallOrder[0];
      const auditCallOrder = (auditService.createLog as jest.Mock).mock.invocationCallOrder[0];

      expect(auditService.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          action: 'EXPENSE_CREATE',
          entityType: 'Expense',
          entityId: 'expense-1',
          metadata: expect.objectContaining({
            source: 'RECURRING_CRONJOB',
            recurringId: 're-b1',
            scopeType: 'BUILDING',
          }),
        }),
      );
      expect(txCallOrder).toBeLessThan(auditCallOrder);
    });

    it('audit de cron BUILDING NO incluye allocationMode', async () => {
      jest.spyOn(prisma.recurringExpense, 'findMany').mockResolvedValue([buildingRule()] as any);

      await service.processRecurringExpenses();

      const metadata = (auditService.createLog as jest.Mock).mock.calls[0][0].metadata;
      expect(metadata).not.toHaveProperty('allocationMode');
    });
  });

  // ========== CRON — TENANT_SHARED MANUAL ==========
  describe('processRecurringExpenses — TENANT_SHARED MANUAL', () => {
    const manualRule = () =>
      makeRecurring({
        id: 're-t1',
        scopeType: 'TENANT_SHARED',
        allocationMode: 'MANUAL',
        nextRunDate: new Date('2020-01-01'),
        allocations: [
          { buildingId: 'building-1', percentage: 60 },
          { buildingId: 'building-2', percentage: 40 },
        ],
      });

    beforeEach(() => {
      tx.expense.create.mockResolvedValue({
        id: 'expense-t1',
        tenantId,
        buildingId: null,
        scopeType: 'TENANT_SHARED',
      });
      tx.recurringExpense.updateMany.mockResolvedValue({ count: 1 });
    });

    it('MANUAL válido: usa allocations almacenadas, valida, crea Expense TENANT_SHARED con buildingId null, llama createForExpenseInTx, actualiza nextRunDate, createdCount=1', async () => {
      jest.spyOn(prisma.recurringExpense, 'findMany').mockResolvedValue([manualRule()] as any);

      const result = await service.processRecurringExpenses();

      const expectedAllocations = manualRule().allocations;
      expect(movementAllocationService.validateAllocations).toHaveBeenCalledWith(
        tenantId,
        expectedAllocations,
        10000,
        'ARS',
      );
      expect(tx.expense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            buildingId: null,
            scopeType: 'TENANT_SHARED',
            status: 'DRAFT',
          }),
        }),
      );
      expect(movementAllocationService.createForExpenseInTx).toHaveBeenCalledWith(
        tx,
        tenantId,
        'expense-t1',
        10000,
        'ARS',
        expectedAllocations,
      );
      expect(tx.recurringExpense.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 're-t1', tenantId },
        }),
      );
      expect(result.createdCount).toBe(1);
    });

    it('MANUAL sin template allocations: falla sin Expense ni nextRunDate', async () => {
      const rule = manualRule();
      rule.allocations = [];
      jest.spyOn(prisma.recurringExpense, 'findMany').mockResolvedValue([rule] as any);

      const result = await service.processRecurringExpenses();

      expect(movementAllocationService.validateAllocations).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(result.createdCount).toBe(0);
    });

    it('MANUAL con reparto inválido: validateAllocations falla, no entra en mutaciones', async () => {
      jest.spyOn(prisma.recurringExpense, 'findMany').mockResolvedValue([manualRule()] as any);
      (movementAllocationService.validateAllocations as jest.Mock).mockRejectedValueOnce(
        new BadRequestException('invalid reparto'),
      );

      const result = await service.processRecurringExpenses();

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(result.createdCount).toBe(0);
      expect(loggerErrorSpy).toHaveBeenCalled();
    });

    it('createForExpenseInTx falla: transacción rechazada, sin nextRunDate ni audit, createdCount no incrementa', async () => {
      jest.spyOn(prisma.recurringExpense, 'findMany').mockResolvedValue([manualRule()] as any);
      (movementAllocationService.createForExpenseInTx as jest.Mock).mockRejectedValueOnce(
        new Error('allocation tx failed'),
      );

      const result = await service.processRecurringExpenses();

      expect(tx.recurringExpense.updateMany).not.toHaveBeenCalled();
      expect(auditService.createLog).not.toHaveBeenCalled();
      expect(result.createdCount).toBe(0);
    });

    it('audit de cron TENANT_SHARED incluye allocationMode MANUAL', async () => {
      jest.spyOn(prisma.recurringExpense, 'findMany').mockResolvedValue([manualRule()] as any);

      await service.processRecurringExpenses();

      const metadata = (auditService.createLog as jest.Mock).mock.calls[0][0].metadata;
      expect(metadata).toHaveProperty('allocationMode', 'MANUAL');
    });
  });

  // ========== CRON — EQUAL_SHARE ==========
  describe('processRecurringExpenses — EQUAL_SHARE', () => {
    const equalRule = () =>
      makeRecurring({
        id: 're-e1',
        scopeType: 'TENANT_SHARED',
        allocationMode: 'EQUAL_SHARE',
        nextRunDate: new Date('2020-01-01'),
        allocations: [],
      });

    const suggestions = [
      { buildingId: 'building-1', buildingName: 'A', totalM2: 0, percentage: 50 },
      { buildingId: 'building-2', buildingName: 'B', totalM2: 0, percentage: 50 },
    ];

    beforeEach(() => {
      (movementAllocationService.suggestAllocationsByMode as jest.Mock).mockResolvedValue(suggestions);
      tx.expense.create.mockResolvedValue({ id: 'expense-e1', tenantId, scopeType: 'TENANT_SHARED' });
      tx.recurringExpense.updateMany.mockResolvedValue({ count: 1 });
    });

    it('llama suggestAllocationsByMode con tenantId y EQUAL_SHARE, valida sugerencias y usa createForExpenseInTx', async () => {
      jest.spyOn(prisma.recurringExpense, 'findMany').mockResolvedValue([equalRule()] as any);

      const result = await service.processRecurringExpenses();

      expect(movementAllocationService.suggestAllocationsByMode).toHaveBeenCalledWith(
        tenantId,
        'EQUAL_SHARE',
      );
      expect(movementAllocationService.validateAllocations).toHaveBeenCalledWith(
        tenantId,
        [
          { buildingId: 'building-1', percentage: 50 },
          { buildingId: 'building-2', percentage: 50 },
        ],
        10000,
        'ARS',
      );
      expect(movementAllocationService.createForExpenseInTx).toHaveBeenCalledWith(
        tx,
        tenantId,
        'expense-e1',
        10000,
        'ARS',
        [
          { buildingId: 'building-1', percentage: 50 },
          { buildingId: 'building-2', percentage: 50 },
        ],
      );
      expect(result.createdCount).toBe(1);
    });

    it('sugerencias []: no Expense, no nextRunDate, createdCount no incrementa', async () => {
      jest.spyOn(prisma.recurringExpense, 'findMany').mockResolvedValue([equalRule()] as any);
      (movementAllocationService.suggestAllocationsByMode as jest.Mock).mockResolvedValue([]);

      const result = await service.processRecurringExpenses();

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(result.createdCount).toBe(0);
    });
  });

  // ========== CRON — BUILDING_TOTAL_M2 ==========
  describe('processRecurringExpenses — BUILDING_TOTAL_M2', () => {
    const m2Rule = () =>
      makeRecurring({
        id: 're-m1',
        scopeType: 'TENANT_SHARED',
        allocationMode: 'BUILDING_TOTAL_M2',
        nextRunDate: new Date('2020-01-01'),
        allocations: [],
      });

    beforeEach(() => {
      (movementAllocationService.suggestAllocationsByMode as jest.Mock).mockResolvedValue([
        { buildingId: 'building-1', buildingName: 'A', totalM2: 100, percentage: 100 },
      ]);
      tx.expense.create.mockResolvedValue({ id: 'expense-m1', tenantId, scopeType: 'TENANT_SHARED' });
      tx.recurringExpense.updateMany.mockResolvedValue({ count: 1 });
    });

    it('llama suggestAllocationsByMode con BUILDING_TOTAL_M2, valida y crea Expense + allocations vía createForExpenseInTx', async () => {
      jest.spyOn(prisma.recurringExpense, 'findMany').mockResolvedValue([m2Rule()] as any);

      const result = await service.processRecurringExpenses();

      expect(movementAllocationService.suggestAllocationsByMode).toHaveBeenCalledWith(
        tenantId,
        'BUILDING_TOTAL_M2',
      );
      expect(movementAllocationService.validateAllocations).toHaveBeenCalled();
      expect(movementAllocationService.createForExpenseInTx).toHaveBeenCalled();
      expect(result.createdCount).toBe(1);
    });

    it('cero edificios: falla de forma segura sin mutaciones', async () => {
      jest.spyOn(prisma.recurringExpense, 'findMany').mockResolvedValue([m2Rule()] as any);
      (movementAllocationService.suggestAllocationsByMode as jest.Mock).mockResolvedValue([]);

      const result = await service.processRecurringExpenses();

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(result.createdCount).toBe(0);
    });
  });

  // ========== AISLAMIENTO MULTITENANT ==========
  describe('aislamiento multitenant', () => {
    const buildingScope = { scopeType: 'BUILDING' as const, buildingId };
    const tenantScope = { scopeType: 'TENANT_SHARED' as const, buildingId: null };

    it('findFirst de update incorpora tenantId, scopeType y buildingId', async () => {
      (prisma.recurringExpense.findFirst as jest.Mock)
        .mockResolvedValueOnce(
          makeRecurring({ buildingId, scopeType: 'BUILDING' }),
        )
        .mockResolvedValueOnce(
          makeRecurring({ buildingId, scopeType: 'BUILDING', amount: 500 }),
        );
      (prisma.recurringExpense.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await service.updateRecurringExpense(tenantId, recurringId, { amount: 500 }, buildingScope);

      expect(prisma.recurringExpense.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: recurringId, tenantId, scopeType: 'BUILDING', buildingId },
        }),
      );
      expect(prisma.recurringExpense.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: recurringId, tenantId } }),
      );
    });

    it('no permite actualizar una regla de otro tenant (NotFound sin mutación)', async () => {
      (prisma.recurringExpense.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateRecurringExpense('tenant-other', recurringId, { amount: 1 }, buildingScope),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.recurringExpense.updateMany).not.toHaveBeenCalled();
    });

    it('contexto BUILDING no puede modificar una regla TENANT_SHARED (NotFound)', async () => {
      (prisma.recurringExpense.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateRecurringExpense(tenantId, recurringId, { amount: 1 }, buildingScope),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.recurringExpense.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: recurringId, tenantId, scopeType: 'BUILDING', buildingId },
        }),
      );
      expect(prisma.recurringExpense.updateMany).not.toHaveBeenCalled();
    });

    it('contexto TENANT_SHARED no puede modificar una regla BUILDING (NotFound)', async () => {
      (prisma.recurringExpense.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateRecurringExpense(tenantId, recurringId, { amount: 1 }, tenantScope),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.recurringExpense.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: recurringId, tenantId, scopeType: 'TENANT_SHARED', buildingId: null },
        }),
      );
      expect(prisma.recurringExpense.updateMany).not.toHaveBeenCalled();
    });

    it('TENANT_SHARED correcto: find incluye tenantId + scopeType TENANT_SHARED + buildingId null', async () => {
      (prisma.recurringExpense.findFirst as jest.Mock)
        .mockResolvedValueOnce(
          makeRecurring({ scopeType: 'TENANT_SHARED', allocationMode: 'EQUAL_SHARE' }),
        )
        .mockResolvedValueOnce(
          makeRecurring({ scopeType: 'TENANT_SHARED', allocationMode: 'EQUAL_SHARE', amount: 500 }),
        );
      (prisma.recurringExpense.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await service.updateRecurringExpense(tenantId, recurringId, { amount: 500 }, tenantScope);

      expect(prisma.recurringExpense.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: recurringId, tenantId, scopeType: 'TENANT_SHARED', buildingId: null },
        }),
      );
    });

    it('no permite usar rubro de otro tenant', async () => {
      jest.spyOn(prisma.expenseLedgerCategory, 'findFirst').mockResolvedValue(null);

      await expect(
        service.createRecurringExpense('tenant-1', baseCreateDto, buildingId),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.recurringExpense.create).not.toHaveBeenCalled();
    });

    it('no permite usar building de otro tenant', async () => {
      jest.spyOn(prisma.building, 'findFirst').mockResolvedValue(null);

      await expect(
        service.createRecurringExpense('tenant-1', baseCreateDto, buildingId),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.recurringExpense.create).not.toHaveBeenCalled();
    });

    it('cron updateMany incluye id + tenantId en where', async () => {
      jest.spyOn(prisma.recurringExpense, 'findMany').mockResolvedValue([
        makeRecurring({
          id: 're-c1',
          tenantId,
          buildingId,
          scopeType: 'BUILDING',
          nextRunDate: new Date('2020-01-01'),
        }),
      ] as any);
      tx.expense.create.mockResolvedValue({ id: 'expense-c1', tenantId, buildingId });
      tx.recurringExpense.updateMany.mockResolvedValue({ count: 1 });

      await service.processRecurringExpenses();

      expect(tx.recurringExpense.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 're-c1', tenantId },
        }),
      );
    });
  });

  // ========== PROCESS CONTINÚA TRAS FALLO ==========
  describe('processRecurringExpenses — continúa tras fallo', () => {
    it('regla A falla, regla B válida: A se registra en error, B se procesa, createdCount=1', async () => {
      const ruleA = makeRecurring({
        id: 're-a',
        buildingId: null,
        scopeType: 'BUILDING',
        nextRunDate: new Date('2020-01-01'),
      });
      const ruleB = makeRecurring({
        id: 're-b',
        buildingId,
        scopeType: 'BUILDING',
        nextRunDate: new Date('2020-01-01'),
      });
      jest.spyOn(prisma.recurringExpense, 'findMany').mockResolvedValue([ruleA, ruleB] as any);
      tx.expense.create.mockResolvedValue({ id: 'expense-b', tenantId, buildingId });
      tx.recurringExpense.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.processRecurringExpenses();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process recurring expense re-a'),
        expect.any(String),
      );
      expect(tx.expense.create).toHaveBeenCalledTimes(1);
      expect(tx.recurringExpense.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 're-b', tenantId } }),
      );
      expect(result.createdCount).toBe(1);
    });
  });
});
