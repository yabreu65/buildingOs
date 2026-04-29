import { AssistantService, MockAiProvider } from './assistant.service';

describe('AssistantService - P0 yoryi bridge lock', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.restoreAllMocks();
    process.env = {
      ...originalEnv,
      AI_PROVIDER: 'MOCK',
      ASSISTANT_YORYI_ENGINE_ENABLED: 'true',
      ASSISTANT_P0_ENFORCEMENT_ENABLED: 'true',
      YORYI_ASSISTANT_API_BASE_URL: 'https://yoryi.test',
      ASSISTANT_YORYI_TIMEOUT_MS: '2000',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const makeService = () => {
    const prisma = {} as any;
    const audit = { createLog: jest.fn().mockResolvedValue(undefined) } as any;
    const budget = {
      checkCallsLimit: jest.fn().mockResolvedValue({ allowed: true, callsUsed: 0, callsLimit: 100 }),
      getEffectiveLimits: jest.fn().mockResolvedValue({ allowBigModel: true }),
      checkBudget: jest.fn().mockResolvedValue({
        allowed: true,
        usedCents: 0,
        budgetCents: 500,
        blockedAt: null,
        percentUsed: 0,
      }),
      trackUsage: jest.fn().mockResolvedValue(undefined),
      logDegradedResponse: jest.fn().mockResolvedValue(undefined),
    } as any;
    const router = {
      classifyRequest: jest.fn().mockReturnValue({ model: 'SMALL' }),
      getModelName: jest.fn().mockReturnValue('gpt-4.1-nano'),
      getMaxTokens: jest.fn().mockReturnValue(150),
    } as any;
    const cache = {
      generateKey: jest.fn().mockReturnValue('k1'),
      get: jest.fn().mockReturnValue(null),
      set: jest.fn(),
    } as any;
    const contextSummary = {
      getSummary: jest.fn().mockResolvedValue(null),
    } as any;
    const ollamaProvider = { chat: jest.fn() } as any;
    const mockAiProvider: MockAiProvider = {
      chat: jest.fn().mockResolvedValue({ answer: 'local provider answer', suggestedActions: [] }),
    } as any;

    const service = new AssistantService(
      prisma,
      audit,
      budget,
      router,
      cache,
      contextSummary,
      ollamaProvider,
      mockAiProvider,
    );

    jest.spyOn(service as any, 'validateContext').mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
      membershipId: 'membership-1',
      page: 'dashboard',
      userRoles: ['TENANT_ADMIN'],
    });
    jest.spyOn(service as any, 'checkRateLimit').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'tryResolveStrictOperationalQuestion').mockResolvedValue(null);
    jest.spyOn(service as any, 'logInteraction').mockResolvedValue(null);
    jest.spyOn(service as any, 'filterSuggestedActions').mockImplementation((actions: any[]) => actions);

    return { service, budget, mockAiProvider };
  };

  it('does NOT fallback to local provider when yoryi responds !ok', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    (global as any).fetch = fetchMock;

    const { service, budget, mockAiProvider } = makeService();

    const result = await service.chat(
      'tenant-1',
      'user-1',
      'membership-1',
      { message: 'tickets abiertos', page: 'dashboard' },
      ['TENANT_ADMIN'],
    );

    expect(result.answer).toContain('No puedo confirmar una respuesta operativa segura');
    expect(result.suggestedActions).toEqual([]);
    expect((mockAiProvider.chat as jest.Mock)).not.toHaveBeenCalled();
    expect(budget.checkBudget).not.toHaveBeenCalled();
  });

  it('does NOT fallback to local provider when yoryi payload is invalid', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: '',
        answerSource: 'live_data',
      }),
    });
    (global as any).fetch = fetchMock;

    const { service, budget, mockAiProvider } = makeService();

    const result = await service.chat(
      'tenant-1',
      'user-1',
      'membership-1',
      { message: 'pagos pendientes', page: 'dashboard' },
      ['TENANT_ADMIN'],
    );

    expect(result.answer).toContain('No puedo confirmar una respuesta operativa segura');
    expect(result.suggestedActions).toEqual([]);
    expect((mockAiProvider.chat as jest.Mock)).not.toHaveBeenCalled();
    expect(budget.checkBudget).not.toHaveBeenCalled();
  });

  it('does NOT fallback to local provider when yoryi answerSource is disallowed', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: 'Respuesta doctrinal',
        answerSource: 'knowledge',
        actions: [],
      }),
    });
    (global as any).fetch = fetchMock;

    const { service, budget, mockAiProvider } = makeService();

    const result = await service.chat(
      'tenant-1',
      'user-1',
      'membership-1',
      { message: 'deuda de unidad 101', page: 'dashboard' },
      ['TENANT_ADMIN'],
    );

    expect(result.answer).toContain('No puedo confirmar una respuesta operativa segura');
    expect(result.suggestedActions).toEqual([]);
    expect((mockAiProvider.chat as jest.Mock)).not.toHaveBeenCalled();
    expect(budget.checkBudget).not.toHaveBeenCalled();
  });

  it('allows fallback when yoryi is disabled', async () => {
    process.env.ASSISTANT_YORYI_ENGINE_ENABLED = 'false';

    const { service, mockAiProvider } = makeService();

    const result = await service.chat(
      'tenant-1',
      'user-1',
      'membership-1',
      { message: 'tickets abiertos', page: 'dashboard' },
      ['TENANT_ADMIN'],
    );

    expect((mockAiProvider.chat as jest.Mock)).toHaveBeenCalled();
    expect(result.answer).toBe('local provider answer');
  });

  it('allows fallback when yoryi is unavailable (no baseUrl)', async () => {
    process.env.YORYI_ASSISTANT_API_BASE_URL = '';

    const { service, mockAiProvider } = makeService();

    const result = await service.chat(
      'tenant-1',
      'user-1',
      'membership-1',
      { message: 'pagos pendientes', page: 'dashboard' },
      ['TENANT_ADMIN'],
    );

    expect((mockAiProvider.chat as jest.Mock)).toHaveBeenCalled();
    expect(result.answer).toBe('local provider answer');
  });
});