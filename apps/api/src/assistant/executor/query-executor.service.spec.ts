import { QueryExecutorService } from './query-executor.service';
import { ExecutionPlan } from '../intent-engine/intent.types';

describe('QueryExecutorService', () => {
  const mockPrisma = {
    $queryRaw: jest.fn(),
    charge: { findMany: jest.fn() },
    payment: { findMany: jest.fn() },
    document: { findMany: jest.fn() },
    ticket: { count: jest.fn(), findMany: jest.fn() },
    unitOccupant: { findMany: jest.fn() },
    unit: { findMany: jest.fn() },
    building: { findMany: jest.fn() },
    tenant: { findUniqueOrThrow: jest.fn() },
  };
  const mockAuthorize = { authorize: jest.fn() };
  const mockFeedback = { logExecution: jest.fn() };
  const mockRegistry = { get: jest.fn() };

  let service: QueryExecutorService;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_RBAC_BYPASS = 'false';
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/buildingos_test';

    service = new QueryExecutorService(
      mockPrisma as never,
      mockAuthorize as never,
      mockFeedback as never,
      mockRegistry as never,
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('execute', () => {
    it('logs execution time and query shape via AssistantFeedbackService', async () => {
      const plan: ExecutionPlan = {
        intent: 'unit_residents',
        entityIds: { buildingId: 'b-1', unitId: 'u-1' },
        filters: {},
        pagination: { limit: 20 },
      };

      mockRegistry.get.mockReturnValue({
        name: 'unit_residents',
        requiredPermission: 'units.read',
        supportedFilters: [],
        supportedResponseTypes: ['table'],
        executor: jest.fn().mockResolvedValue({ data: [] }),
      });
      mockAuthorize.authorize.mockResolvedValue(true);

      await service.execute(plan, 'tenant-1', 'user-1', ['OPERATOR']);

      expect(mockFeedback.logExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: 'unit_residents',
          success: true,
          tenantId: 'tenant-1',
          userId: 'user-1',
        }),
      );
    });

    it('returns raw data from executor', async () => {
      const plan: ExecutionPlan = {
        intent: 'unit_residents',
        entityIds: { buildingId: 'b-1', unitId: 'u-1' },
        filters: {},
        pagination: { limit: 20 },
      };

      const mockData = [{ id: '1', name: 'Test' }];
      mockRegistry.get.mockReturnValue({
        name: 'unit_residents',
        requiredPermission: 'units.read',
        supportedFilters: [],
        supportedResponseTypes: ['table'],
        executor: jest.fn().mockResolvedValue({ data: mockData }),
      });
      mockAuthorize.authorize.mockResolvedValue(true);

      const result = await service.execute(plan, 'tenant-1', 'user-1', ['OPERATOR']);

      expect(result).toEqual(mockData);
    });
  });

  describe('RBAC enforcement', () => {
    it('throws when user lacks required permission', async () => {
      const plan: ExecutionPlan = {
        intent: 'unit_debt',
        entityIds: { buildingId: 'b-1', unitId: 'u-1' },
        filters: {},
        pagination: { limit: 20 },
      };

      mockRegistry.get.mockReturnValue({
        name: 'unit_debt',
        requiredPermission: 'payments.review',
        supportedFilters: [],
        supportedResponseTypes: ['kpi'],
        executor: jest.fn(),
      });
      mockAuthorize.authorize.mockResolvedValue(false);

      await expect(service.execute(plan, 'tenant-1', 'user-1', ['RESIDENT'])).rejects.toThrow();
    });

    it('allows explicit local RBAC bypass only with ALLOW_RBAC_BYPASS=true and local DB', async () => {
      process.env.ALLOW_RBAC_BYPASS = 'true';
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/buildingos_local';

      const plan: ExecutionPlan = {
        intent: 'unit_residents',
        entityIds: { buildingId: 'b-1', unitId: 'u-1' },
        filters: {},
        pagination: { limit: 20 },
      };

      mockRegistry.get.mockReturnValue({
        name: 'unit_residents',
        requiredPermission: 'units.read',
        supportedFilters: [],
        supportedResponseTypes: ['table'],
        executor: jest.fn().mockResolvedValue({ data: [] }),
      });

      await service.execute(plan, 'tenant-1', 'user-1', ['OPERATOR']);

      expect(mockAuthorize.authorize).not.toHaveBeenCalled();
    });

    it('never bypasses RBAC when DATABASE_URL is non-local even if flag is true', async () => {
      process.env.ALLOW_RBAC_BYPASS = 'true';
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL = 'postgresql://prod-db.company.internal:5432/buildingos';

      const plan: ExecutionPlan = {
        intent: 'unit_residents',
        entityIds: { buildingId: 'b-1', unitId: 'u-1' },
        filters: {},
        pagination: { limit: 20 },
      };

      mockRegistry.get.mockReturnValue({
        name: 'unit_residents',
        requiredPermission: 'units.read',
        supportedFilters: [],
        supportedResponseTypes: ['table'],
        executor: jest.fn().mockResolvedValue({ data: [] }),
      });
      mockAuthorize.authorize.mockResolvedValue(true);

      await service.execute(plan, 'tenant-1', 'user-1', ['OPERATOR']);

      expect(mockAuthorize.authorize).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('handles Prisma errors gracefully', async () => {
      const plan: ExecutionPlan = {
        intent: 'unit_residents',
        entityIds: { buildingId: 'b-1', unitId: 'u-1' },
        filters: {},
        pagination: { limit: 20 },
      };

      mockRegistry.get.mockReturnValue({
        name: 'unit_residents',
        requiredPermission: 'units.read',
        supportedFilters: [],
        supportedResponseTypes: ['table'],
        executor: jest.fn().mockRejectedValue(new Error('Prisma error')),
      });
      mockAuthorize.authorize.mockResolvedValue(true);

      await expect(service.execute(plan, 'tenant-1', 'user-1', ['OPERATOR'])).rejects.toThrow('Prisma error');
    });
  });

  describe('intent registry lookup', () => {
    it('looks up intent in IntentRegistry', async () => {
      const plan: ExecutionPlan = {
        intent: 'unit_residents',
        entityIds: { buildingId: 'b-1', unitId: 'u-1' },
        filters: {},
        pagination: { limit: 20 },
      };

      const mockExecutor = jest.fn().mockResolvedValue({ data: [] });
      mockRegistry.get.mockReturnValue({
        name: 'unit_residents',
        requiredPermission: 'units.read',
        supportedFilters: [],
        supportedResponseTypes: ['table'],
        executor: mockExecutor,
      });
      mockAuthorize.authorize.mockResolvedValue(true);

      await service.execute(plan, 'tenant-1', 'user-1', ['OPERATOR']);

      expect(mockRegistry.get).toHaveBeenCalledWith('unit_residents');
    });
  });
});
