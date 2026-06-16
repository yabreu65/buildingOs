import { AssistantFeedbackService, LogExecutionParams } from './assistant-feedback.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AssistantFeedbackService', () => {
  let service: AssistantFeedbackService;
  let mockPrisma: jest.Mocked<PrismaService>;
  let loggerDebugSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    mockPrisma = {} as jest.Mocked<PrismaService>;
    service = new AssistantFeedbackService(mockPrisma);
    loggerDebugSpy = jest.spyOn((service as any).logger, 'debug').mockImplementation();
    loggerWarnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation();
  });

  afterEach(() => {
    loggerDebugSpy.mockRestore();
    loggerWarnSpy.mockRestore();
  });

  const baseParams: LogExecutionParams = {
    intent: 'list_payments',
    entity: { type: 'building', buildingAlias: 'Torre A' },
    filters: { status: 'pending' },
    success: true,
    durationMs: 150,
    tenantId: 'tenant-1',
    userId: 'user-1',
  };

  describe('logExecution', () => {
    it('logs successful execution with intent and entity', async () => {
      service.logExecution(baseParams);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(loggerDebugSpy).toHaveBeenCalled();
      const logCall = loggerDebugSpy.mock.calls.at(-1)?.[0] as string;
      expect(logCall).toContain('[AssistantFeedback]');
      expect(logCall).toContain('Execution log:');
      expect(logCall).toContain('list_payments');
      expect(logCall).toContain('Torre A');
    });

    it('logs with entity label from unit code', async () => {
      const unitParams: LogExecutionParams = {
        ...baseParams,
        entity: { type: 'unit', unitCode: '101' },
      };

      service.logExecution(unitParams);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(loggerDebugSpy).toHaveBeenCalled();
      const logCall = loggerDebugSpy.mock.calls.at(-1)?.[0] as string;
      expect(logCall).toContain('101');
    });

    it('logs with entity label from person name', async () => {
      const personParams: LogExecutionParams = {
        ...baseParams,
        entity: { type: 'person', personName: 'John Doe' },
      };

      service.logExecution(personParams);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(loggerDebugSpy).toHaveBeenCalled();
      const logCall = loggerDebugSpy.mock.calls.at(-1)?.[0] as string;
      expect(logCall).toContain('John Doe');
    });

    it('logs failed execution with error message', async () => {
      const failedParams: LogExecutionParams = {
        ...baseParams,
        success: false,
        error: 'Database connection timeout',
      };

      service.logExecution(failedParams);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(loggerDebugSpy).toHaveBeenCalled();
      const logCall = loggerDebugSpy.mock.calls.at(-1)?.[0] as string;
      expect(logCall).toContain('Database connection timeout');
    });

    it('handles empty filters object', async () => {
      const emptyFiltersParams: LogExecutionParams = {
        ...baseParams,
        filters: {},
      };

      service.logExecution(emptyFiltersParams);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(loggerDebugSpy).toHaveBeenCalled();
    });

    it('does not throw when called with valid params', async () => {
      expect(() => service.logExecution(baseParams)).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it('output contains entityType', async () => {
      service.logExecution(baseParams);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const logCall = loggerDebugSpy.mock.calls.at(-1)?.[0] as string;
      expect(logCall).toContain('building');
    });

    it('output contains success flag', async () => {
      service.logExecution(baseParams);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const logCall = loggerDebugSpy.mock.calls.at(-1)?.[0] as string;
      expect(logCall).toContain('success');
    });

    it('output contains numeric duration', async () => {
      service.logExecution(baseParams);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const logCall = loggerDebugSpy.mock.calls.at(-1)?.[0] as string;
      expect(logCall).toContain('150');
    });

    it('output contains tenantId value', async () => {
      service.logExecution(baseParams);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const logCall = loggerDebugSpy.mock.calls.at(-1)?.[0] as string;
      expect(logCall).toContain('tenant-1');
    });

    it('output contains userId value', async () => {
      service.logExecution(baseParams);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const logCall = loggerDebugSpy.mock.calls.at(-1)?.[0] as string;
      expect(logCall).toContain('user-1');
    });

    it('output contains timestamp', async () => {
      service.logExecution(baseParams);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const logCall = loggerDebugSpy.mock.calls.at(-1)?.[0] as string;
      expect(logCall).toContain('timestamp');
    });

    it('output contains filters', async () => {
      service.logExecution(baseParams);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const logCall = loggerDebugSpy.mock.calls.at(-1)?.[0] as string;
      expect(logCall).toContain('filters');
    });
  });
});
