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

    expect(result.metadata?.gatewayOutcome).toBe('unavailable');
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

    expect(result.metadata?.gatewayOutcome).toBe('invalid_payload');
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

    expect(result.metadata?.gatewayOutcome).toBe('denied');
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

  it('accepts yoryi payload without top-level toolName', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: 'La unidad 101 tiene deuda pendiente de ARS 120.000',
        answerSource: 'live_data',
        responseType: 'summary',
        actions: [],
      }),
    });
    (global as any).fetch = fetchMock;

    const { service, mockAiProvider } = makeService();

    const result = await service.chat(
      'tenant-1',
      'user-1',
      'membership-1',
      { message: 'cuanto debe la unidad 101 torre a', page: 'payments' },
      ['TENANT_ADMIN'],
    );

    expect(result.answer).toContain('deuda pendiente');
    expect((mockAiProvider.chat as jest.Mock)).not.toHaveBeenCalled();
  });

  it('accepts building synonym "edificio" for strict operational prompts', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: 'La unidad A-1203 no tiene deuda pendiente',
        answerSource: 'live_data',
        responseType: 'summary',
        actions: [],
      }),
    });
    (global as any).fetch = fetchMock;

    const { service, mockAiProvider } = makeService();

    const result = await service.chat(
      'tenant-1',
      'user-1',
      'membership-1',
      { message: 'cuanto debe unidad A-1203 del edificio A', page: 'payments' },
      ['TENANT_ADMIN'],
    );

    expect(result.answer).toContain('no tiene deuda');
    expect((mockAiProvider.chat as jest.Mock)).not.toHaveBeenCalled();
  });

  it('treats "esta al dia" as strict unit debt query', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: 'La unidad A-1203 no tiene deuda pendiente. Saldo actual: ARS 0,00.',
        answerSource: 'live_data',
        responseType: 'summary',
        actions: [],
      }),
    });
    (global as any).fetch = fetchMock;

    const { service, mockAiProvider } = makeService();

    const result = await service.chat(
      'tenant-1',
      'user-1',
      'membership-1',
      { message: 'esta al dia la unidad A-1203 torre A', page: 'payments' },
      ['TENANT_ADMIN'],
    );

    expect(result.answer).toContain('no tiene deuda');
    expect((mockAiProvider.chat as jest.Mock)).not.toHaveBeenCalled();
  });

  it('extracts intentCode from provenance metadata', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: 'La unidad 123 debe ARS 5000',
        answerSource: 'live_data',
        responseType: 'metric',
        actions: [],
        provenance: {
          sources: [{ metadata: { intentCode: 'GET_UNIT_DEBT', traceId: 'trace-123' } }],
        },
      }),
    });
    (global as any).fetch = fetchMock;

    const { service } = makeService();

    const result = await service.chat(
      'tenant-1',
      'user-1',
      'membership-1',
      { message: 'cuanto debe la unidad 123 torre a', page: 'payments' },
      ['TENANT_ADMIN'],
    );

    expect(result.metadata?.intentCode).toBe('GET_UNIT_DEBT');
    expect(result.metadata?.traceId).toBe('trace-123');
  });

  it('returns controlled timeout response when yoryi aborts', async () => {
    const abortError = new Error('aborted');
    (abortError as any).name = 'AbortError';
    const fetchMock = jest.fn().mockRejectedValue(abortError);
    (global as any).fetch = fetchMock;

    const { service, mockAiProvider } = makeService();

    const result = await service.chat(
      'tenant-1',
      'user-1',
      'membership-1',
      { message: 'cuanto debe la unidad 101 torre a', page: 'payments' },
      ['TENANT_ADMIN'],
    );

    expect(result.metadata?.gatewayOutcome).toBe('timeout');
    expect((mockAiProvider.chat as jest.Mock)).not.toHaveBeenCalled();
  });

  it('returns contract_mismatch for non-operational disallowed answerSource', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: 'Respuesta doctrinal de tickets',
        answerSource: 'knowledge',
        responseType: 'summary',
        actions: [],
      }),
    });
    (global as any).fetch = fetchMock;

    const { service, mockAiProvider } = makeService();

    const result = await service.chat(
      'tenant-1',
      'user-1',
      'membership-1',
      { message: 'tickets abiertos', page: 'dashboard' },
      ['TENANT_ADMIN'],
    );

    expect(result.metadata?.gatewayOutcome).toBe('contract_mismatch');
    expect((mockAiProvider.chat as jest.Mock)).not.toHaveBeenCalled();
  });

  it('extractUnitToken supports uf alias', () => {
    const { service } = makeService();
    const token = (service as any).extractUnitToken('saldo uf 1203 torre a');
    expect(token).toBe('1203');
  });

  it('extractUnitToken supports depto+piso composite format', () => {
    const { service } = makeService();
    const token = (service as any).extractUnitToken('cuanto debe depto 03 piso 12 torre a');
    expect(token).toBe('12-03');
  });

  it('extractUnitToken normalizes short dept format 12-3 to 12-03', () => {
    const { service } = makeService();
    const token = (service as any).extractUnitToken('cuanto debe la unidad 12-3 torre a');
    expect(token).toBe('12-03');
  });

  it('matchesUnitToken supports floor-dept token against A-1203 code', () => {
    const { service } = makeService();
    const matches = (service as any).matchesUnitToken(
      { code: 'A-1203', label: 'Torre A - Piso 12 - Depto 03' },
      '12-03',
    );
    expect(matches).toBe(true);
  });

  it('resolveStrictUnitMatch returns direct match when single candidate', async () => {
    const prisma = {
      building: { findMany: jest.fn().mockResolvedValue([{ id: 'b1', name: 'Torre A' }]) },
      unit: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'u1', code: 'A-1203', label: 'Torre A - Piso 12 - Depto 03' },
        ]),
      },
    } as any;
    const audit = { createLog: jest.fn().mockResolvedValue(undefined) } as any;
    const budget = {
      checkCallsLimit: jest.fn(),
      getEffectiveLimits: jest.fn(),
      checkBudget: jest.fn(),
      trackUsage: jest.fn(),
      logDegradedResponse: jest.fn(),
    } as any;
    const router = { classifyRequest: jest.fn(), getModelName: jest.fn(), getMaxTokens: jest.fn() } as any;
    const cache = { generateKey: jest.fn(), get: jest.fn(), set: jest.fn() } as any;
    const contextSummary = { getSummary: jest.fn() } as any;
    const ollamaProvider = { chat: jest.fn() } as any;
    const mockAiProvider: MockAiProvider = { chat: jest.fn() } as any;

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

    const result = await (service as any).resolveStrictUnitMatch('tenant-1', '1203', 'a');
    expect(result.errorResponse).toBeNull();
    expect(result.unit?.id).toBe('u1');
  });

  it('resolveStrictUnitMatch returns clarification when multiple candidates', async () => {
    const prisma = {
      building: { findMany: jest.fn().mockResolvedValue([{ id: 'b1', name: 'Torre A' }]) },
      unit: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'u1', code: 'A-1203', label: 'Torre A - Piso 12 - Depto 03' },
          { id: 'u2', code: 'B-1203', label: 'Torre A - Piso 12 - Depto 03 B' },
        ]),
      },
    } as any;
    const audit = { createLog: jest.fn().mockResolvedValue(undefined) } as any;
    const budget = {
      checkCallsLimit: jest.fn(),
      getEffectiveLimits: jest.fn(),
      checkBudget: jest.fn(),
      trackUsage: jest.fn(),
      logDegradedResponse: jest.fn(),
    } as any;
    const router = { classifyRequest: jest.fn(), getModelName: jest.fn(), getMaxTokens: jest.fn() } as any;
    const cache = { generateKey: jest.fn(), get: jest.fn(), set: jest.fn() } as any;
    const contextSummary = { getSummary: jest.fn() } as any;
    const ollamaProvider = { chat: jest.fn() } as any;
    const mockAiProvider: MockAiProvider = { chat: jest.fn() } as any;

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

    const result = await (service as any).resolveStrictUnitMatch('tenant-1', '1203', 'a');
    expect(result.errorResponse?.answer.toLowerCase()).toContain('ambigua');
  });

  it('classifies top morosos as aggregate debt query', () => {
    const { service } = makeService();
    const result = (service as any).isAggregateDebtQuery('top morosos de la torre a');
    expect(result).toBe(true);
  });

  it('does not force unit+tower gate for aggregate debt queries', async () => {
    const { service } = makeService();
    const aggregateSpy = jest.spyOn(service as any, 'tryResolveAggregateDebtQuestion').mockResolvedValue({
      answer: 'Top deuda por torre/edificio',
      suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
    });
    const result = await (service as any).tryResolveStrictUnitDebtQuestion(
      'tenant-1',
      'top morosos',
      ['TENANT_ADMIN'],
    );
    expect(aggregateSpy).toHaveBeenCalled();
    expect(result?.answer).toContain('Top deuda por torre/edificio');
    expect(result?.answer.toLowerCase()).not.toContain('unidad y torre');
  });

  it('does not force unit+tower gate for debt tower aggregate query', async () => {
    const { service } = makeService();
    const aggregateSpy = jest.spyOn(service as any, 'tryResolveAggregateDebtQuestion').mockResolvedValue({
      answer: 'Resumen de deuda agregada (scope: A)',
      suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
    });
    const result = await (service as any).tryResolveStrictUnitDebtQuestion(
      'tenant-1',
      'deuda torre a',
      ['TENANT_ADMIN'],
    );
    expect(aggregateSpy).toHaveBeenCalled();
    expect(result?.answer).toContain('Resumen de deuda agregada');
    expect(result?.answer.toLowerCase()).not.toContain('unidad y torre');
  });

  it('returns contract fields for strict unit debt answers', async () => {
    const prisma = {
      building: { findMany: jest.fn().mockResolvedValue([{ id: 'b1', name: 'Torre A' }]) },
      unit: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'u1', code: 'A-1203', label: 'Torre A - Piso 12 - Depto 03' },
        ]),
      },
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ currency: 'ARS' }),
      },
      charge: {
        findMany: jest.fn().mockResolvedValue([
          {
            amount: 100,
            paymentAllocations: [{ amount: 60, payment: { status: 'APPROVED' } }],
          },
        ]),
      },
    } as any;
    const audit = { createLog: jest.fn().mockResolvedValue(undefined) } as any;
    const budget = {
      checkCallsLimit: jest.fn(),
      getEffectiveLimits: jest.fn(),
      checkBudget: jest.fn(),
      trackUsage: jest.fn(),
      logDegradedResponse: jest.fn(),
    } as any;
    const router = { classifyRequest: jest.fn(), getModelName: jest.fn(), getMaxTokens: jest.fn() } as any;
    const cache = { generateKey: jest.fn(), get: jest.fn(), set: jest.fn() } as any;
    const contextSummary = { getSummary: jest.fn() } as any;
    const ollamaProvider = { chat: jest.fn() } as any;
    const mockAiProvider: MockAiProvider = { chat: jest.fn() } as any;

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

    const result = await (service as any).tryResolveStrictUnitDebtQuestion(
      'tenant-1',
      'deuda unidad A-1203 torre A',
      ['TENANT_ADMIN'],
    );

    expect(result?.answerSource).toBe('live_data');
    expect(result?.responseType).toBe('exact');
    expect(result?.answer.toLowerCase()).toContain('deuda pendiente');
  });

  it('returns contract fields for aggregate debt answers', async () => {
    const prisma = {
      building: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'b1', name: 'Torre A' },
          { id: 'b2', name: 'Torre B' },
        ]),
      },
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ currency: 'ARS' }),
      },
      charge: {
        findMany: jest.fn().mockResolvedValue([
          { amount: 100, buildingId: 'b1', paymentAllocations: [] },
          { amount: 200, buildingId: 'b2', paymentAllocations: [] },
        ]),
      },
    } as any;
    const audit = { createLog: jest.fn().mockResolvedValue(undefined) } as any;
    const budget = {
      checkCallsLimit: jest.fn(),
      getEffectiveLimits: jest.fn(),
      checkBudget: jest.fn(),
      trackUsage: jest.fn(),
      logDegradedResponse: jest.fn(),
    } as any;
    const router = { classifyRequest: jest.fn(), getModelName: jest.fn(), getMaxTokens: jest.fn() } as any;
    const cache = { generateKey: jest.fn(), get: jest.fn(), set: jest.fn() } as any;
    const contextSummary = { getSummary: jest.fn() } as any;
    const ollamaProvider = { chat: jest.fn() } as any;
    const mockAiProvider: MockAiProvider = { chat: jest.fn() } as any;

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

    const summaryResult = await (service as any).tryResolveAggregateDebtQuestion('tenant-1', 'morosidad mensual');
    expect(summaryResult.answerSource).toBe('live_data');
    expect(summaryResult.responseType).toBe('summary');

    const listResult = await (service as any).tryResolveAggregateDebtQuestion('tenant-1', 'top morosos');
    expect(listResult.answerSource).toBe('live_data');
    expect(listResult.responseType).toBe('list');
  });

  it('normalizes legacy/missing contract fields before final response', () => {
    const { service } = makeService();
    const normalized = (service as any).normalizeResponseContract({
      answer: 'Detalle operativo',
      suggestedActions: [],
      answerSource: undefined,
      responseType: 'answer',
    });

    expect(normalized.answerSource).toBe('fallback');
    expect(normalized.responseType).toBe('summary');
  });

  it('buildYoryiControlledResponse always returns contract-compliant fields', () => {
    const { service } = makeService();
    const blocked = (service as any).buildYoryiControlledResponse('invalid_payload', 'P0', 'trace-1');
    expect(blocked.answerSource).toBe('fallback');
    expect(blocked.responseType).toBe('clarification');
  });
});
