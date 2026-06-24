import { Test, TestingModule } from '@nestjs/testing';
import { AssistantService, MockAiProvider } from './assistant.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiBudgetService } from './budget.service';
import { AiRouterService } from './router.service';
import { AiCacheService } from './cache.service';
import { AiContextSummaryService } from './context-summary.service';
import { OllamaProvider } from './ollama.provider';
import { AiClassifierService } from './classifier.service';
import { AssistantUnitResolverService } from './unit-resolver/assistant-unit-resolver.service';
import { AuthorizeService } from '../rbac/authorize.service';
import { AssistantQueryPlanService } from './query-plan.service';
import { AssistantQueryExecutorsService } from './query-executors.service';
import { AssistantDebtCalculatorService } from './assistant-debt-calculator.service';
import { IntentExtractorService } from './intent-engine/intent-extractor.service';
import { EntityResolverService } from './resolver/entity-resolver.service';
import { AmbiguityService } from './resolver/ambiguity.service';
import { RedisConversationContextService } from './context/redis-conversation-context.service';
import { QueryPlannerService } from './planner/query-planner.service';
import { QueryExecutorService } from './executor/query-executor.service';
import { ResponseFormatterService } from './formatter/response-formatter.service';
import { IntentRegistry } from './intent-engine/intent-registry';
import { FilterCoverageValidator } from './intent-engine/filter-coverage.validator';
import { PaymentStatus, UnitOccupantRole } from '@prisma/client';
import { IntentSemanticValidatorService } from './intent-semantic-validator.service';

/**
 * Suite exhaustiva de tests para TODAS las preguntas operativas
 * que el asistente puede resolver determinísticamente.
 *
 * Cada test verifica una variación de pregunta documentada en:
 * docs/ASSISTANT_QUESTIONS_CATALOG.md
 */

describe('AssistantService - Strict Operational Questions', () => {
  let service: AssistantService;

  const mockPrisma = {
    tenant: { findUniqueOrThrow: jest.fn() },
    building: { findMany: jest.fn(), findFirst: jest.fn() },
    unit: { findMany: jest.fn(), findFirst: jest.fn() },
    unitOccupant: { findMany: jest.fn() },
    charge: { findMany: jest.fn() },
    payment: { findMany: jest.fn(), aggregate: jest.fn(), count: jest.fn() },
    ticket: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
    document: { findMany: jest.fn() },
    membership: { findUnique: jest.fn() },
    aiInteractionLog: { create: jest.fn() },
    aiInteraction: { create: jest.fn() },
    tenantDailyAiUsage: { findUnique: jest.fn(), upsert: jest.fn() },
  };

  const mockAudit = { createLog: jest.fn() };
  const mockBudget = { getEffectiveLimits: jest.fn(), checkCallsLimit: jest.fn() };
  const mockRouter = {
    classifyRequest: jest.fn(),
    getModelName: jest.fn(),
    getMaxTokens: jest.fn(),
  };
  const mockCache = { generateKey: jest.fn(), get: jest.fn(), set: jest.fn() };
  const mockContextSummary = { getSummary: jest.fn() };
  const mockOllama = { chat: jest.fn() };
  const mockMockAiProvider = { chat: jest.fn() };
  const mockClassifier = { classify: jest.fn() };
  const mockUnitResolver = { resolve: jest.fn() };
  const mockAuthorize = { authorize: jest.fn() };
  const mockQueryPlanService = { createPlan: jest.fn() };
  const mockQueryExecutors = { execute: jest.fn() };
  const mockDebtCalculator = new AssistantDebtCalculatorService();
  const mockIntentExtractor = { extractIntent: jest.fn() };
  const mockEntityResolver = { resolveBuilding: jest.fn(), resolveUnit: jest.fn(), resolvePerson: jest.fn() };
  const mockAmbiguityService = { detectAmbiguity: jest.fn(), generateClarification: jest.fn() };
  const mockConversationContext = {
    storeTurn: jest.fn(),
    getContext: jest.fn(),
    getLastResolved: jest.fn(),
    getLastIntent: jest.fn(),
    getPendingClarification: jest.fn(),
    setPendingClarification: jest.fn(),
    clearPendingClarification: jest.fn(),
  };
  const mockQueryPlannerService = { buildPlan: jest.fn() };
  const mockQueryExecutorService = { execute: jest.fn() };
  const mockResponseFormatter = { formatV1: jest.fn(), formatV2: jest.fn() };
  const mockIntentRegistry = { register: jest.fn(), get: jest.fn(), has: jest.fn(), list: jest.fn() };
  const mockFilterCoverageValidator = { analyze: jest.fn() };
  const mockIntentSemanticValidator = { evaluate: jest.fn() };

  const ADMIN_ROLES = ['TENANT_ADMIN'];

  beforeEach(async () => {
    jest.clearAllMocks();

    mockRouter.classifyRequest.mockReturnValue({ model: 'SMALL', intent: 'general' });
    mockRouter.getModelName.mockReturnValue('gpt-4.1-nano');
    mockRouter.getMaxTokens.mockReturnValue(500);
    mockBudget.getEffectiveLimits.mockResolvedValue({ allowBigModel: false });
    mockBudget.checkCallsLimit.mockResolvedValue({ allowed: true, callsUsed: 0, callsLimit: 100 });
    mockPrisma.tenantDailyAiUsage.findUnique.mockResolvedValue(null);
    mockPrisma.tenantDailyAiUsage.upsert.mockResolvedValue({});
    mockPrisma.aiInteractionLog.create.mockResolvedValue({ id: 'interaction-1' });
    mockCache.generateKey.mockImplementation((tenantId, message, page, buildingId, unitId, securityContext) => JSON.stringify({ tenantId, message, page, buildingId, unitId, securityContext }));
    mockCache.get.mockReturnValue(null);
    mockContextSummary.getSummary.mockResolvedValue(null);
    mockAuthorize.authorize.mockResolvedValue(true);
    mockQueryPlanService.createPlan.mockReturnValue(null);
    mockQueryExecutors.execute.mockResolvedValue(null);
    mockConversationContext.getContext.mockResolvedValue([]);
    mockConversationContext.getLastResolved.mockResolvedValue({});
    mockConversationContext.getLastIntent.mockResolvedValue(undefined);
    mockConversationContext.getPendingClarification.mockResolvedValue(undefined);
    mockUnitResolver.resolve.mockResolvedValue({
      resolved: {
        building: { id: 'b1', name: 'Edificio A', alias: 'A' },
        unit: { id: 'u1', code: '0101', label: 'Unidad 0101' },
        displayCode: 'A-0101',
      },
      errorResponse: null,
    });
    mockFilterCoverageValidator.analyze.mockReturnValue({
      complete: true,
      detectedSignals: [],
      missingFields: [],
    });
    mockIntentSemanticValidator.evaluate.mockResolvedValue({
      status: 'accepted',
      reason: 'default_accept',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssistantService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: AiBudgetService, useValue: mockBudget },
        { provide: AiRouterService, useValue: mockRouter },
        { provide: AiCacheService, useValue: mockCache },
        { provide: AiContextSummaryService, useValue: mockContextSummary },
        { provide: OllamaProvider, useValue: mockOllama },
        { provide: MockAiProvider, useValue: mockMockAiProvider },
        { provide: AiClassifierService, useValue: mockClassifier },
        { provide: AssistantUnitResolverService, useValue: mockUnitResolver },
        { provide: AuthorizeService, useValue: mockAuthorize },
        { provide: AssistantQueryPlanService, useValue: mockQueryPlanService },
        { provide: AssistantQueryExecutorsService, useValue: mockQueryExecutors },
        { provide: AssistantDebtCalculatorService, useValue: mockDebtCalculator },
        { provide: IntentExtractorService, useValue: mockIntentExtractor },
        { provide: EntityResolverService, useValue: mockEntityResolver },
        { provide: AmbiguityService, useValue: mockAmbiguityService },
        { provide: RedisConversationContextService, useValue: mockConversationContext },
        { provide: QueryPlannerService, useValue: mockQueryPlannerService },
        { provide: QueryExecutorService, useValue: mockQueryExecutorService },
        { provide: ResponseFormatterService, useValue: mockResponseFormatter },
        { provide: IntentRegistry, useValue: mockIntentRegistry },
        { provide: FilterCoverageValidator, useValue: mockFilterCoverageValidator },
        { provide: IntentSemanticValidatorService, useValue: mockIntentSemanticValidator },
      ],
    }).compile();

    service = module.get<AssistantService>(AssistantService);
  });

  // ============================================================
  // HELPERS
  // ============================================================

  describe('chatV2 follow-ups', () => {
    it('reutiliza las entidades resueltas del turno anterior', async () => {
      const previousResolvedEntities = {
        building: { id: 'building-1', name: 'Edificio A', alias: 'A' },
        unit: { id: 'unit-1203', code: '1203', label: 'A-1203', buildingId: 'building-1' },
        alternatives: [],
      };

      mockConversationContext.getContext.mockResolvedValue([
        {
          role: 'user',
          message: 'deuda unidad A-1203',
          timestamp: new Date(),
          resolvedEntities: previousResolvedEntities,
        },
      ]);
      mockConversationContext.getLastResolved.mockResolvedValue({ buildingId: 'building-1', unitId: 'unit-1203' });
      mockConversationContext.getLastIntent.mockResolvedValue('unit_debt');
      mockIntentExtractor.extractIntent.mockRejectedValue(new Error('LLM failed'));
      mockIntentRegistry.has.mockReturnValue(true);
      mockAmbiguityService.detectAmbiguity.mockReturnValue(false);
      mockQueryPlannerService.buildPlan.mockImplementation((intent, resolved) => ({
        intent: intent.intent,
        entityIds: {
          buildingId: resolved.building?.id,
          unitId: resolved.unit?.id,
          personId: resolved.person?.id,
        },
        filters: intent.filters,
        pagination: { limit: 20 },
      }));
      mockQueryExecutorService.execute.mockResolvedValue({ total: 22669.45 });
      mockResponseFormatter.formatV2.mockReturnValue({
        type: 'text',
        title: 'Deuda',
        summary: 'Deuda total: Bs.S 22.669,45',
        meta: {},
      });

      await service.chatV2(
        'tenant-1',
        'user-1',
        'membership-1',
        { message: 'cuanto meses debe', page: 'dashboard', conversationId: 'conv-1' },
        ADMIN_ROLES,
      );

      expect(mockQueryPlannerService.buildPlan).toHaveBeenCalledWith(
        expect.objectContaining({ intent: 'unit_debt' }),
        previousResolvedEntities,
      );
      expect(mockQueryExecutorService.execute).toHaveBeenCalledWith(
        expect.objectContaining({ entityIds: expect.objectContaining({ unitId: 'unit-1203' }) }),
        'tenant-1',
        'user-1',
        ADMIN_ROLES,
      );
    });

    it('interpreta "mes actual" como respuesta de aclaración para deuda de edificio', async () => {
      const previousResolvedEntities = {
        building: { id: 'demo-B', name: 'Edificio del Río', alias: 'B' },
        alternatives: [],
      };

      mockConversationContext.getContext.mockResolvedValue([
        {
          role: 'user',
          message: 'deuda total edificio B',
          timestamp: new Date(),
          resolvedEntities: previousResolvedEntities,
        },
      ]);
      mockConversationContext.getLastResolved.mockResolvedValue({ buildingId: 'demo-B' });
      mockConversationContext.getLastIntent.mockResolvedValue('building_debt');
      mockIntentExtractor.extractIntent.mockRejectedValue(new Error('Need clarification')); 
      mockIntentRegistry.has.mockReturnValue(true);
      mockAmbiguityService.detectAmbiguity.mockReturnValue(false);
      mockQueryPlannerService.buildPlan.mockImplementation((intent, resolved) => ({
        intent: intent.intent,
        entityIds: {
          buildingId: resolved.building?.id,
          unitId: resolved.unit?.id,
          personId: resolved.person?.id,
        },
        filters: intent.filters,
        pagination: { limit: 20 },
      }));
      mockQueryExecutorService.execute.mockResolvedValue({ totalDebt: 115801, currency: 'ARS' });
      mockResponseFormatter.formatV2.mockReturnValue({
        type: 'kpi',
        title: 'Deuda',
        summary: 'Deuda total: ARS 1.158,01',
        meta: {},
      });

      await service.chatV2(
        'tenant-1',
        'user-1',
        'membership-1',
        { message: 'mes actual', page: 'charges', conversationId: 'conv-1' },
        ADMIN_ROLES,
      );

      expect(mockQueryPlannerService.buildPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: 'building_debt',
          filters: expect.objectContaining({ period: new Date().toISOString().slice(0, 7) }),
        }),
        previousResolvedEntities,
      );
      expect(mockQueryExecutorService.execute).toHaveBeenCalledWith(
        expect.objectContaining({ entityIds: expect.objectContaining({ buildingId: 'demo-B' }) }),
        'tenant-1',
        'user-1',
        ADMIN_ROLES,
      );
    });

    it('rehidrata aclaración pendiente para "acumulada" usando el edificio original', async () => {
      const previousResolvedEntities = {
        building: { id: 'demo-B', name: 'Edificio del Río', alias: 'B' },
        alternatives: [],
      };

      mockConversationContext.getContext.mockResolvedValue([
        {
          role: 'user',
          message: 'deuda total edificio B',
          timestamp: new Date(),
          resolvedEntities: previousResolvedEntities,
        },
      ]);
      mockConversationContext.getLastResolved.mockResolvedValue({ buildingId: 'demo-B' });
      mockConversationContext.getLastIntent.mockResolvedValue('building_debt');
      mockConversationContext.getPendingClarification.mockResolvedValue({
        intent: 'building_debt',
        entity: { type: 'building', buildingAlias: 'B' },
        filters: {},
        missingFields: ['period'],
        question: '¿Querés la deuda de este mes o la deuda acumulada?',
        resolvedEntityIds: { buildingId: 'demo-B' },
      });
      mockPrisma.building.findFirst.mockResolvedValue({
        id: 'building-a',
        tenantId: 'tenant-1',
        name: 'Edificio A',
        alias: 'A',
        deletedAt: null,
      });
      mockIntentRegistry.has.mockReturnValue(true);
      mockAmbiguityService.detectAmbiguity.mockReturnValue(false);
      mockQueryPlannerService.buildPlan.mockImplementation((intent, resolved) => ({
        intent: intent.intent,
        entityIds: {
          buildingId: resolved.building?.id,
          unitId: resolved.unit?.id,
          personId: resolved.person?.id,
        },
        filters: intent.filters,
        pagination: { limit: 20 },
      }));
      mockQueryExecutorService.execute.mockResolvedValue({ totalDebt: 474568, currency: 'ARS' });
      mockResponseFormatter.formatV2.mockReturnValue({
        type: 'kpi',
        title: 'Deuda',
        summary: 'Deuda total: ARS 4.745,68',
        meta: {},
      });

      await service.chatV2(
        'tenant-1',
        'user-1',
        'membership-1',
        {
          message: 'acumulada',
          page: 'charges',
          buildingId: 'building-a',
          conversationId: 'conv-1',
        },
        ADMIN_ROLES,
      );

      expect(mockQueryPlannerService.buildPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: 'building_debt',
          filters: {},
        }),
        expect.objectContaining({
          building: expect.objectContaining({ id: 'demo-B', alias: 'B' }),
        }),
      );
      expect(mockQueryExecutorService.execute).toHaveBeenCalledWith(
        expect.objectContaining({ entityIds: expect.objectContaining({ buildingId: 'demo-B' }) }),
        'tenant-1',
        'user-1',
        ADMIN_ROLES,
      );
      expect(mockConversationContext.clearPendingClarification).toHaveBeenCalledWith(
        'tenant-1',
        'user-1',
        'conv-1',
      );
    });

    it.each(['torre A', 'edificio A', 'A'])(
      'rehidrata aclaración pendiente para "%s" usando el período acumulado ya confirmado',
      async (followUpMessage) => {
        mockConversationContext.getContext.mockResolvedValue([]);
        mockConversationContext.getLastResolved.mockResolvedValue({});
        mockConversationContext.getLastIntent.mockResolvedValue('building_debt');
        mockConversationContext.getPendingClarification.mockResolvedValue({
          intent: 'building_debt',
          entity: { type: 'building' },
          filters: { period: 'accumulated' },
          missingFields: ['building'],
          question: 'Necesito que me indiques el edificio/torre para esa consulta.',
        });
        mockIntentRegistry.has.mockReturnValue(true);
        mockAmbiguityService.detectAmbiguity.mockReturnValue(false);
        mockEntityResolver.resolveBuilding.mockResolvedValue({
          building: { id: 'demo-A', name: 'Torre A', alias: 'A' },
          alternatives: [],
        });
        mockQueryPlannerService.buildPlan.mockImplementation((intent, resolved) => ({
          intent: intent.intent,
          entityIds: {
            buildingId: resolved.building?.id,
            unitId: resolved.unit?.id,
            personId: resolved.person?.id,
          },
          filters: intent.filters,
          pagination: { limit: 20 },
        }));
        mockQueryExecutorService.execute.mockResolvedValue({ totalDebt: 474568, currency: 'ARS' });
        mockResponseFormatter.formatV2.mockReturnValue({
          type: 'kpi',
          title: 'Deuda',
          summary: 'Deuda total: ARS 4.745,68',
          meta: {},
        });

        await service.chatV2(
          'tenant-1',
          'user-1',
          'membership-1',
          { message: followUpMessage, page: 'charges', conversationId: 'conv-1' },
          ADMIN_ROLES,
        );

        expect(mockQueryPlannerService.buildPlan).toHaveBeenCalledWith(
          expect.objectContaining({
            intent: 'building_debt',
            filters: expect.objectContaining({ period: 'accumulated' }),
          }),
          expect.objectContaining({
            building: expect.objectContaining({ id: 'demo-A', alias: 'A' }),
          }),
        );
        expect(mockQueryExecutorService.execute).toHaveBeenCalledWith(
          expect.objectContaining({ entityIds: expect.objectContaining({ buildingId: 'demo-A' }) }),
          'tenant-1',
          'user-1',
          ADMIN_ROLES,
        );
      },
    );

    it('preserva el período cuando un follow-up de edificio no se puede resolver', async () => {
      mockConversationContext.getContext.mockResolvedValue([]);
      mockConversationContext.getLastResolved.mockResolvedValue({});
      mockConversationContext.getLastIntent.mockResolvedValue('building_debt');
      mockConversationContext.getPendingClarification.mockResolvedValue({
        intent: 'building_debt',
        entity: { type: 'building' },
        filters: { period: 'accumulated' },
        missingFields: ['building'],
        question: 'Necesito que me indiques el edificio/torre para esa consulta.',
      });
      mockIntentRegistry.has.mockReturnValue(true);
      mockAmbiguityService.detectAmbiguity.mockReturnValue(false);
      mockEntityResolver.resolveBuilding.mockResolvedValue(null);
      mockResponseFormatter.formatV2.mockReturnValue({
        type: 'clarification',
        title: 'Aclaración',
        summary: 'No encontré el edificio/torre "torre inexistente". ¿Podés elegir uno de estos: ...?',
        meta: {},
      });

      const result = await service.chatV2(
        'tenant-1',
        'user-1',
        'membership-1',
        { message: 'torre inexistente', page: 'charges', conversationId: 'conv-1' },
        ADMIN_ROLES,
      );

      expect(mockQueryExecutorService.execute).not.toHaveBeenCalled();
      expect(mockQueryPlannerService.buildPlan).not.toHaveBeenCalled();
      expect(result.type).toBe('clarification');
    });

    it.each(['histórica', 'toda'])(
      'rehidrata aclaración pendiente para "%s" sin perder el edificio original',
      async (followUpMessage) => {
        const previousResolvedEntities = {
          building: { id: 'demo-B', name: 'Edificio del Río', alias: 'B' },
          alternatives: [],
        };

        mockConversationContext.getContext.mockResolvedValue([
          {
            role: 'user',
            message: 'deuda total edificio B',
            timestamp: new Date(),
            resolvedEntities: previousResolvedEntities,
          },
        ]);
        mockConversationContext.getLastResolved.mockResolvedValue({ buildingId: 'demo-B' });
        mockConversationContext.getLastIntent.mockResolvedValue('building_debt');
        mockConversationContext.getPendingClarification.mockResolvedValue({
          intent: 'building_debt',
          entity: { type: 'building', buildingAlias: 'B' },
          filters: {},
          missingFields: ['period'],
          question: '¿Querés la deuda de este mes o la deuda acumulada?',
          resolvedEntityIds: { buildingId: 'demo-B' },
        });
        mockIntentRegistry.has.mockReturnValue(true);
        mockAmbiguityService.detectAmbiguity.mockReturnValue(false);
        mockQueryPlannerService.buildPlan.mockImplementation((intent, resolved) => ({
          intent: intent.intent,
          entityIds: {
            buildingId: resolved.building?.id,
            unitId: resolved.unit?.id,
            personId: resolved.person?.id,
          },
          filters: intent.filters,
          pagination: { limit: 20 },
        }));
        mockQueryExecutorService.execute.mockResolvedValue({ totalDebt: 474568, currency: 'ARS' });
        mockResponseFormatter.formatV2.mockReturnValue({
          type: 'kpi',
          title: 'Deuda',
          summary: 'Deuda total: ARS 4.745,68',
          meta: {},
        });

        await service.chatV2(
          'tenant-1',
          'user-1',
          'membership-1',
          { message: followUpMessage, page: 'charges', conversationId: 'conv-1' },
          ADMIN_ROLES,
        );

        expect(mockQueryExecutorService.execute).toHaveBeenCalledWith(
          expect.objectContaining({ entityIds: expect.objectContaining({ buildingId: 'demo-B' }) }),
          'tenant-1',
          'user-1',
          ADMIN_ROLES,
        );
      },
    );
  });

  describe('chatV2 semantic validation', () => {
    it('asks for clarification instead of executing historical building debt without period', async () => {
      mockConversationContext.getContext.mockResolvedValue([]);
      mockConversationContext.getLastResolved.mockResolvedValue({});
      mockConversationContext.getLastIntent.mockResolvedValue(undefined);
      mockQueryPlanService.createPlan.mockReturnValue({
        intent: 'building_debt',
        module: 'payments',
        scope: 'building',
        requiredPermission: 'payments.review',
        executor: 'building_debt',
        filters: { buildingAlias: 'B', buildingToken: 'B' },
        confidence: 0.9,
        source: 'deterministic_rules',
      });
      mockIntentExtractor.extractIntent.mockResolvedValue({
        intent: 'building_debt',
        entity: { type: 'building', buildingAlias: 'B' },
        filters: {},
        confidence: 0.9,
        source: 'deterministic',
        llmProvider: 'none',
        requiresClarification: false,
        missingFields: [],
      });
      mockIntentRegistry.has.mockReturnValue(true);
      mockIntentSemanticValidator.evaluate.mockResolvedValue({
        status: 'needs_clarification',
        reason: 'period_ambiguous',
        question: '¿Querés la deuda de este mes o la deuda acumulada?',
      });
      mockEntityResolver.resolveBuilding.mockResolvedValue({
        building: { id: 'demo-B', name: 'Edificio del Río', alias: 'B' },
        alternatives: [],
      });
      mockResponseFormatter.formatV2.mockReturnValue({
        type: 'clarification',
        title: 'Aclaración',
        summary: '¿Querés la deuda de este mes o la deuda acumulada?',
        meta: {},
      });

      const result = await service.chatV2(
        'tenant-1',
        'user-1',
        'membership-1',
        { message: 'deuda total edificio B', page: 'charges', conversationId: 'conv-1' },
        ADMIN_ROLES,
      );

      expect(mockIntentSemanticValidator.evaluate).toHaveBeenCalled();
      expect(mockQueryPlannerService.buildPlan).not.toHaveBeenCalled();
      expect(mockQueryExecutorService.execute).not.toHaveBeenCalled();
      expect(mockConversationContext.storeTurn).toHaveBeenCalledWith(
        'tenant-1',
        'user-1',
        'conv-1',
        expect.objectContaining({
          message: 'deuda total edificio B',
          resolvedEntities: expect.objectContaining({
            building: expect.objectContaining({ id: 'demo-B', alias: 'B' }),
          }),
        }),
        expect.objectContaining({ intent: 'building_debt' }),
      );
      expect(mockConversationContext.setPendingClarification).toHaveBeenCalledWith(
        'tenant-1',
        'user-1',
        'conv-1',
        expect.objectContaining({
          intent: 'building_debt',
          entity: expect.objectContaining({ buildingAlias: 'B' }),
          missingFields: ['period'],
          resolvedEntityIds: expect.objectContaining({ buildingId: 'demo-B' }),
        }),
      );
      expect(result.type).toBe('clarification');
    });

    it('falls back to deterministic debt plan when Gemini fails for condominio debt', async () => {
      mockConversationContext.getContext.mockResolvedValue([]);
      mockConversationContext.getLastResolved.mockResolvedValue({});
      mockConversationContext.getLastIntent.mockResolvedValue(undefined);
      mockQueryPlanService.createPlan.mockReturnValue({
        intent: 'building_debt',
        module: 'payments',
        scope: 'building',
        requiredPermission: 'payments.review',
        executor: 'building_debt',
        filters: {},
        confidence: 0.85,
        source: 'deterministic_rules',
      });
      mockIntentExtractor.extractIntent.mockRejectedValue(new Error('Gemini API error: 400 Bad Request'));
      mockIntentRegistry.has.mockReturnValue(true);
      mockIntentSemanticValidator.evaluate.mockResolvedValue({
        status: 'needs_clarification',
        reason: 'building_scope_missing_context',
        question: '¿De cuál condominio/edificio quieres consultar la deuda?',
      });
      mockResponseFormatter.formatV2.mockReturnValue({
        type: 'clarification',
        title: 'Aclaración',
        summary: '¿De cuál condominio/edificio quieres consultar la deuda?',
        meta: {},
      });

      const result = await service.chatV2(
        'tenant-1',
        'user-1',
        'membership-1',
        { message: 'deuda del condominio', page: 'charges', conversationId: 'conv-1' },
        ADMIN_ROLES,
      );

      expect(mockIntentSemanticValidator.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({
          deterministicPlan: expect.objectContaining({
            intent: 'building_debt',
            confidence: 0.85,
          }),
          extractedIntent: expect.objectContaining({
            intent: 'building_debt',
            confidence: 0.85,
            source: 'hybrid',
            llmProvider: 'none',
          }),
        }),
      );
      expect(mockQueryPlannerService.buildPlan).not.toHaveBeenCalled();
      expect(mockQueryExecutorService.execute).not.toHaveBeenCalled();
      expect(result.type).toBe('clarification');
    });

    it('uses finance period context before executing building debt', async () => {
      mockConversationContext.getContext.mockResolvedValue([]);
      mockConversationContext.getLastResolved.mockResolvedValue({});
      mockConversationContext.getLastIntent.mockResolvedValue(undefined);
      mockQueryPlanService.createPlan.mockReturnValue({
        intent: 'building_debt',
        module: 'payments',
        scope: 'building',
        requiredPermission: 'payments.review',
        executor: 'building_debt',
        filters: { buildingAlias: 'B', buildingToken: 'B' },
        confidence: 0.9,
        source: 'deterministic_rules',
      });
      mockIntentExtractor.extractIntent.mockResolvedValue({
        intent: 'building_debt',
        entity: { type: 'building', buildingAlias: 'B' },
        filters: {},
        confidence: 0.9,
        source: 'deterministic',
        llmProvider: 'none',
        requiresClarification: false,
        missingFields: [],
      });
      mockIntentRegistry.has.mockReturnValue(true);
      mockIntentSemanticValidator.evaluate.mockResolvedValue({
        status: 'override_suggested',
        reason: 'finance_context_period',
        filterOverrides: { period: '2026-06', financePeriod: '2026-06' },
      });
      mockPrisma.building.findFirst.mockResolvedValue({
        id: 'demo-B',
        tenantId: 'tenant-1',
        deletedAt: null,
      });
      mockEntityResolver.resolveBuilding.mockResolvedValue({
        building: { id: 'demo-B', name: 'Edificio del Río', alias: 'B' },
        alternatives: [],
      });
      mockAmbiguityService.detectAmbiguity.mockReturnValue(false);
      mockQueryPlannerService.buildPlan.mockImplementation((intent, resolved) => ({
        intent: intent.intent,
        entityIds: { buildingId: resolved.building?.id },
        filters: intent.filters,
        pagination: { limit: 20 },
      }));
      mockQueryExecutorService.execute.mockResolvedValue({ totalDebt: 115801, currency: 'ARS' });
      mockResponseFormatter.formatV2.mockReturnValue({
        type: 'kpi',
        title: 'Deuda',
        summary: 'Deuda total: ARS 1.158,01',
        meta: {},
      });

      await service.chatV2(
        'tenant-1',
        'user-1',
        'membership-1',
        {
          message: 'deuda total edificio B',
          page: 'charges',
          currentPage: '/tenant-1/buildings/demo-B/finance',
          financePeriod: '2026-06',
          buildingId: 'demo-B',
          conversationId: 'conv-1',
        },
        ADMIN_ROLES,
      );

      expect(mockQueryPlannerService.buildPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: 'building_debt',
          filters: expect.objectContaining({ period: '2026-06', financePeriod: '2026-06' }),
        }),
        expect.objectContaining({
          building: expect.objectContaining({ id: 'demo-B' }),
        }),
      );
      expect(mockQueryExecutorService.execute).toHaveBeenCalled();
    });
  });

  describe('chatV2 debug payload', () => {
    it('includes debug metadata when request.debug=true', async () => {
      mockConversationContext.getContext.mockResolvedValue([]);
      mockConversationContext.getLastResolved.mockResolvedValue({});
      mockConversationContext.getLastIntent.mockResolvedValue(undefined);
      mockIntentExtractor.extractIntent.mockResolvedValue({
        intent: 'building_tickets',
        entity: { type: 'building', buildingAlias: 'A' },
        filters: { status: 'OPEN', minAgeDays: 7 },
        confidence: 0.9,
        source: 'deterministic',
        requiresClarification: false,
        missingFields: [],
      });
      mockIntentRegistry.has.mockReturnValue(true);
      mockEntityResolver.resolveBuilding.mockResolvedValue({
        building: { id: 'building-1', name: 'Edificio A', alias: 'A' },
        alternatives: [],
      });
      mockAmbiguityService.detectAmbiguity.mockReturnValue(false);
      mockQueryPlannerService.buildPlan.mockReturnValue({
        intent: 'building_tickets',
        entityIds: { buildingId: 'building-1' },
        filters: { status: 'OPEN', minAgeDays: 7 },
        pagination: { limit: 20 },
      });
      mockQueryExecutorService.execute.mockResolvedValue({ tickets: [] });
      mockResponseFormatter.formatV2.mockReturnValue({
        type: 'table',
        title: 'Tickets',
        summary: 'Sin tickets',
        data: { tickets: [] },
        meta: { intent: 'building_tickets', confidence: 0.9, tenantScoped: true },
      });

      const result = await service.chatV2(
        'tenant-1',
        'user-1',
        'membership-1',
        {
          message: 'Tickets abiertos hace más de 7 días en edificio A',
          page: 'tickets',
          conversationId: 'conv-1',
          debug: true,
        },
        ADMIN_ROLES,
      );

      expect(result.debug).toBeDefined();
      expect(result.debug?.finalIntent).toBe('building_tickets');
      expect(result.debug?.zodValidationPassed).toBe(true);
      expect(result.debug?.rbacChecked).toBe(true);
      expect(result.debug?.tenantScoped).toBe(true);
    });
  });

  describe('chatV2 temporarily unavailable intents', () => {
    it('returns controlled response for temporarily unavailable intents', async () => {
      mockConversationContext.getContext.mockResolvedValue([]);
      mockConversationContext.getLastResolved.mockResolvedValue({});
      mockConversationContext.getLastIntent.mockResolvedValue(undefined);
      mockIntentExtractor.extractIntent.mockResolvedValue({
        intent: 'vendors_list',
        entity: { type: 'building', buildingAlias: 'A' },
        filters: {},
        confidence: 0.9,
        source: 'llm',
        requiresClarification: false,
        missingFields: [],
      });

      const result = await service.chatV2(
        'tenant-1',
        'user-1',
        'membership-1',
        { message: 'lista de proveedores', page: 'dashboard', conversationId: 'conv-unavailable' },
        ADMIN_ROLES,
      );

      expect(result.type).toBe('text');
      expect(result.summary).toContain('aún no está disponible');
      expect(mockQueryPlannerService.buildPlan).not.toHaveBeenCalled();
      expect(mockQueryExecutorService.execute).not.toHaveBeenCalled();
    });

    it('includes debug payload for temporarily unavailable intents when debug=true', async () => {
      mockConversationContext.getContext.mockResolvedValue([]);
      mockConversationContext.getLastResolved.mockResolvedValue({});
      mockConversationContext.getLastIntent.mockResolvedValue(undefined);
      mockIntentExtractor.extractIntent.mockResolvedValue({
        intent: 'cashflow_compare',
        entity: { type: 'building', buildingAlias: 'A' },
        filters: {},
        confidence: 0.88,
        source: 'hybrid',
        requiresClarification: false,
        missingFields: [],
      });

      const result = await service.chatV2(
        'tenant-1',
        'user-1',
        'membership-1',
        {
          message: 'compará ingresos y gastos',
          page: 'dashboard',
          conversationId: 'conv-unavailable-debug',
          debug: true,
        },
        ADMIN_ROLES,
      );

      expect(result.debug).toBeDefined();
      expect(result.debug?.finalIntent).toBeUndefined();
      expect(mockQueryPlannerService.buildPlan).not.toHaveBeenCalled();
      expect(mockQueryExecutorService.execute).not.toHaveBeenCalled();
    });
  });

  describe('chatV2 entity guards', () => {
    it('returns clarification when unit intent cannot resolve requested unit', async () => {
      mockConversationContext.getContext.mockResolvedValue([]);
      mockConversationContext.getLastResolved.mockResolvedValue({});
      mockConversationContext.getLastIntent.mockResolvedValue(undefined);
      mockIntentExtractor.extractIntent.mockResolvedValue({
        intent: 'unit_debt',
        entity: { type: 'unit', buildingAlias: 'A', unitCode: '0123' },
        filters: {},
        confidence: 0.9,
        source: 'deterministic',
        llmProvider: 'none',
        requiresClarification: false,
        missingFields: [],
      });
      mockIntentRegistry.has.mockReturnValue(true);
      mockEntityResolver.resolveBuilding.mockResolvedValue({
        building: { id: 'building-1', name: 'Torre A', alias: 'A' },
        alternatives: [],
      });
      mockEntityResolver.resolveUnit.mockResolvedValue(null);
      mockUnitResolver.resolve.mockResolvedValue({
        resolved: null,
        errorResponse: {
          answer: 'No encontré la unidad A-0123. ¿Querés revisar el código?',
          suggestedActions: [],
        },
      });
      mockResponseFormatter.formatV2.mockReturnValue({
        type: 'clarification',
        title: 'Aclaración',
        summary: 'No encontré la unidad solicitada.',
        data: [],
        meta: { intent: 'unit_debt', confidence: 0.9, tenantScoped: true },
      });

      const result = await service.chatV2(
        'tenant-1',
        'user-1',
        'membership-1',
        { message: 'deuda de la unidad A-0123', page: 'dashboard', conversationId: 'conv-x' },
        ADMIN_ROLES,
      );

      expect(result.type).toBe('clarification');
      expect(mockQueryExecutorService.execute).not.toHaveBeenCalled();
    });

    it('uses operational unit resolver when no explicit building is provided', async () => {
      mockConversationContext.getContext.mockResolvedValue([]);
      mockConversationContext.getLastResolved.mockResolvedValue({});
      mockConversationContext.getLastIntent.mockResolvedValue(undefined);
      mockIntentExtractor.extractIntent.mockResolvedValue({
        intent: 'unit_debt',
        entity: { type: 'unit', unitCode: 'A-0123' },
        filters: {},
        confidence: 0.9,
        source: 'deterministic',
        llmProvider: 'none',
        requiresClarification: false,
        missingFields: [],
      });
      mockIntentRegistry.has.mockReturnValue(true);
      mockEntityResolver.resolveBuilding.mockResolvedValue(null);
      mockEntityResolver.resolveUnit.mockResolvedValue(null);
      mockUnitResolver.resolve.mockResolvedValue({
        resolved: {
          building: { id: 'building-1', name: 'Torre A', alias: 'A' },
          unit: { id: 'unit-123', code: '0123', label: 'A-0123' },
          displayCode: 'A-0123',
        },
        errorResponse: null,
      });
      mockAmbiguityService.detectAmbiguity.mockReturnValue(false);
      mockQueryPlannerService.buildPlan.mockReturnValue({
        intent: 'unit_debt',
        entityIds: { buildingId: 'building-1', unitId: 'unit-123' },
        filters: {},
        pagination: { limit: 20 },
      });
      mockQueryExecutorService.execute.mockResolvedValue({ total: 1000 });
      mockResponseFormatter.formatV2.mockReturnValue({
        type: 'text',
        title: 'Deuda',
        summary: 'Deuda total: ARS 1.000,00',
        data: {},
        meta: {},
      });

      const result = await service.chatV2(
        'tenant-1',
        'user-1',
        'membership-1',
        { message: 'deuda de la unidad A-0123', page: 'dashboard', conversationId: 'conv-x' },
        ADMIN_ROLES,
      );

      expect(result.type).toBe('text');
      expect(mockUnitResolver.resolve).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
        unitCode: 'A-0123',
      }));
      expect(mockQueryExecutorService.execute).toHaveBeenCalled();
    });
  });

  describe('follow-up detection rules', () => {
    // Caso 1: sujeto explícito con contexto previo → NO follow-up
    it('Caso 1: "hay alguien con deuda" con contexto → NO es follow-up (sujeto explícito)', async () => {
      mockConversationContext.getContext.mockResolvedValue([
        {
          role: 'user',
          message: 'deuda unidad A-1203',
          timestamp: new Date(),
          resolvedEntities: {
            building: { id: 'b1', name: 'Edificio A', alias: 'A' },
            unit: { id: 'u1', code: '1203', label: 'A-1203', buildingId: 'b1' },
            alternatives: [],
          },
        },
      ]);
      mockConversationContext.getLastResolved.mockResolvedValue({ buildingId: 'b1', unitId: 'u1' });
      mockConversationContext.getLastIntent.mockResolvedValue('unit_debt');

      const isFollowUp = await (service as any).detectFollowUp(
        'hay alguien con deuda mayor a 500',
        await mockConversationContext.getContext(),
        'tenant-1',
        'user-1',
        'conv-1',
      );

      expect(isFollowUp).toBe(false);
    });

    // Caso 2: sin contexto previo → NO follow-up
    it('Caso 2: "hay deuda?" sin contexto → NO es follow-up (sin contexto útil)', async () => {
      mockConversationContext.getContext.mockResolvedValue([]);
      mockConversationContext.getLastResolved.mockResolvedValue({});
      mockConversationContext.getLastIntent.mockResolvedValue(undefined);

      const isFollowUp = await (service as any).detectFollowUp(
        'hay deuda?',
        [],
        'tenant-1',
        'user-1',
        'conv-1',
      );

      expect(isFollowUp).toBe(false);
    });

    // Caso 3: mensaje corto + continuidad + contexto útil → SÍ follow-up
    it('Caso 3: "y cuántos meses" con lastEntity → SÍ es follow-up', async () => {
      mockConversationContext.getContext.mockResolvedValue([
        {
          role: 'user',
          message: 'deuda unidad A-1203',
          timestamp: new Date(),
          resolvedEntities: {
            building: { id: 'b1', name: 'Edificio A', alias: 'A' },
            unit: { id: 'u1', code: '1203', label: 'A-1203', buildingId: 'b1' },
            alternatives: [],
          },
        },
      ]);
      mockConversationContext.getLastResolved.mockResolvedValue({ buildingId: 'b1', unitId: 'u1' });
      mockConversationContext.getLastIntent.mockResolvedValue('unit_debt');

      const isFollowUp = await (service as any).detectFollowUp(
        'y cuántos meses',
        await mockConversationContext.getContext(),
        'tenant-1',
        'user-1',
        'conv-1',
      );

      expect(isFollowUp).toBe(true);
    });

    // Caso 4: sujeto explícito nuevo con contexto → NO follow-up
    it('Caso 4: "y la unidad A-0101" con contexto → NO es follow-up (sujeto explícito)', async () => {
      mockConversationContext.getContext.mockResolvedValue([
        {
          role: 'user',
          message: 'deuda unidad A-1203',
          timestamp: new Date(),
          resolvedEntities: {
            building: { id: 'b1', name: 'Edificio A', alias: 'A' },
            unit: { id: 'u1', code: '1203', label: 'A-1203', buildingId: 'b1' },
            alternatives: [],
          },
        },
      ]);
      mockConversationContext.getLastResolved.mockResolvedValue({ buildingId: 'b1', unitId: 'u1' });
      mockConversationContext.getLastIntent.mockResolvedValue('unit_debt');

      const isFollowUp = await (service as any).detectFollowUp(
        'y la unidad A-0101',
        await mockConversationContext.getContext(),
        'tenant-1',
        'user-1',
        'conv-1',
      );

      expect(isFollowUp).toBe(false);
    });
  });

  describe('person resolution in chatV2', () => {
    it('pide aclaración cuando hay múltiples personas con el mismo nombre', async () => {
      mockConversationContext.getContext.mockResolvedValue([]);
      mockConversationContext.getLastResolved.mockResolvedValue({});
      mockConversationContext.getLastIntent.mockResolvedValue(undefined);

      mockIntentExtractor.extractIntent.mockResolvedValue({
        intent: 'unit_debt',
        entity: { type: 'person', personName: 'Juan Pérez' },
        filters: {},
        confidence: 0.9,
        source: 'llm',
        requiresClarification: false,
        missingFields: [],
      });
      mockIntentRegistry.has.mockReturnValue(true);
      mockEntityResolver.resolvePerson.mockResolvedValue({
        person: { id: 'person-1', name: 'Juan Pérez', unitId: 'unit-1' },
        alternatives: [
          {
            type: 'person',
            id: 'person-2',
            displayName: 'Juan Pérez (B-0201)',
            matchScore: 0.82,
            reason: 'Coincidencia parcial',
          },
        ],
      });
      mockAmbiguityService.detectAmbiguity.mockReturnValue(true);
      mockAmbiguityService.generateClarification.mockReturnValue({
        isAmbiguous: true,
        alternatives: [
          {
            intent: 'unknown',
            entity: { type: 'person' },
            confidence: 0.82,
            reason: 'Coincidencia parcial',
          },
        ],
        clarificationMessage: 'Encontré más de un Juan Pérez. ¿A cuál te referís?',
      });
      mockResponseFormatter.formatV2.mockReturnValue({
        type: 'clarification',
        title: 'Aclaración',
        summary: 'Encontré más de un Juan Pérez. ¿A cuál te referís?',
        meta: { intent: 'ambiguous', confidence: 0.9, tenantScoped: true },
      });

      const result = await service.chatV2(
        'tenant-1',
        'user-1',
        'membership-1',
        { message: '¿Cuánto debe Juan Pérez?', page: 'dashboard', conversationId: 'conv-1' },
        ADMIN_ROLES,
      );

      expect(mockEntityResolver.resolvePerson).toHaveBeenCalledWith('Juan Pérez', 'tenant-1');
      expect(mockResponseFormatter.formatV2).toHaveBeenCalled();
      expect(result.type).toBe('clarification');
    });
  });

  const setupBuildings = (buildings: Array<{ id: string; name: string }>) => {
    mockPrisma.building.findMany.mockResolvedValue(buildings);
  };

  const setupUnits = (units: Array<{ id: string; code: string; label: string | null; buildingId?: string }>) => {
    mockPrisma.unit.findMany.mockResolvedValue(units);
  };

  const setupTenant = (currency = 'ARS') => {
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue({ currency });
  };

  // ============================================================
  // 1. RESIDENTES / OCUPANTES (Unit-level)
  // ============================================================

  describe('1. Residentes / Ocupantes', () => {
    beforeEach(() => {
      setupBuildings([{ id: 'b1', name: 'Edificio A' }]);
      setupUnits([{ id: 'u1', code: '101', label: 'Departamento 101', buildingId: 'b1' }]);
      setupTenant();
    });

    it('P1: responde "como se llama el residente"', async () => {
      mockPrisma.unitOccupant.findMany.mockResolvedValue([
        {
          isPrimary: true,
          role: UnitOccupantRole.OWNER,
          member: { name: 'Juan Pérez' },
        },
      ]);

      const result = await (service as any).tryResolveStrictResidentNameQuestion(
        'tenant-1',
        'Como se llama el residente del departamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Juan Pérez');
      expect(result.answer).toContain('propietario');
    });

    it('P2: responde "quien es el residente del apartamento"', async () => {
      mockPrisma.unitOccupant.findMany.mockResolvedValue([
        {
          isPrimary: true,
          role: UnitOccupantRole.TENANT,
          member: { name: 'María Gómez' },
        },
      ]);

      const result = await (service as any).tryResolveStrictResidentNameQuestion(
        'tenant-1',
        'Quien es el residente del apartamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('María Gómez');
      expect(result.answer).toContain('residente');
    });

    it('P3: responde "nombre del residente de la unidad"', async () => {
      mockPrisma.unitOccupant.findMany.mockResolvedValue([
        {
          isPrimary: true,
          role: UnitOccupantRole.OWNER,
          member: { name: 'Carlos López' },
        },
      ]);

      const result = await (service as any).tryResolveStrictResidentNameQuestion(
        'tenant-1',
        'Nombre del residente de la unidad 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Carlos López');
    });

    it('P4: responde "nombre del residente propietario"', async () => {
      mockPrisma.unitOccupant.findMany.mockResolvedValue([
        {
          isPrimary: false,
          role: UnitOccupantRole.OWNER,
          member: { name: 'Ana Rodríguez' },
        },
      ]);

      const result = await (service as any).tryResolveStrictResidentNameQuestion(
        'tenant-1',
        'Nombre del residente propietario del departamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Ana Rodríguez');
      expect(result.answer).toContain('propietario');
    });

    it('P5: responde "nombre del residente del depto"', async () => {
      mockPrisma.unitOccupant.findMany.mockResolvedValue([
        {
          isPrimary: true,
          role: UnitOccupantRole.TENANT,
          member: { name: 'Pedro Martínez' },
        },
      ]);

      const result = await (service as any).tryResolveStrictResidentNameQuestion(
        'tenant-1',
        'Nombre del residente del depto 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Pedro Martínez');
    });

    it('P1-F1: sin ocupantes activos', async () => {
      mockPrisma.unitOccupant.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictResidentNameQuestion(
        'tenant-1',
        'Como se llama el residente del departamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result.answer).toContain('no tiene ocupantes activos');
    });

    it('P1-F2: multiples ocupantes primarios', async () => {
      mockPrisma.unitOccupant.findMany.mockResolvedValue([
        { isPrimary: true, role: UnitOccupantRole.OWNER, member: { name: 'A' } },
        { isPrimary: true, role: UnitOccupantRole.OWNER, member: { name: 'B' } },
      ]);

      const result = await (service as any).tryResolveStrictResidentNameQuestion(
        'tenant-1',
        'Como se llama el residente del departamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result.answer).toContain('más de un ocupante primario');
    });

    it('P1-F3: falta unidad o edificio → retorna null para classifier', async () => {
      const result = await (service as any).tryResolveStrictResidentNameQuestion(
        'tenant-1',
        'Como se llama el residente',
        ADMIN_ROLES,
      );

      expect(result).toBeNull(); // Ahora va al classifier o fallback
    });

    it('P1-V1: matchea "quien vive" sin residente', async () => {
      mockPrisma.unitOccupant.findMany.mockResolvedValue([
        { isPrimary: true, role: UnitOccupantRole.TENANT, member: { name: 'Luis Torres' } },
      ]);

      const result = await (service as any).tryResolveStrictResidentNameQuestion(
        'tenant-1',
        'Quien vive en el apartamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Luis Torres');
    });

    it('P1-V2: matchea "inquilino"', async () => {
      mockPrisma.unitOccupant.findMany.mockResolvedValue([
        { isPrimary: true, role: UnitOccupantRole.TENANT, member: { name: 'Sofía Ruiz' } },
      ]);

      const result = await (service as any).tryResolveStrictResidentNameQuestion(
        'tenant-1',
        'Inquilino del departamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Sofía Ruiz');
    });

    it('P1-V3: matchea "propietario"', async () => {
      mockPrisma.unitOccupant.findMany.mockResolvedValue([
        { isPrimary: true, role: UnitOccupantRole.OWNER, member: { name: 'Diego Fernández' } },
      ]);

      const result = await (service as any).tryResolveStrictResidentNameQuestion(
        'tenant-1',
        'Propietario del departamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Diego Fernández');
    });
  });

  // ============================================================
  // 2. DEUDA / SALDO (Unit-level)
  // ============================================================

  describe('2. Deuda / Saldo Pendiente (Unit-level)', () => {
    beforeEach(() => {
      setupBuildings([{ id: 'b1', name: 'Edificio A' }]);
      setupUnits([{ id: 'u1', code: '101', label: 'Departamento 101', buildingId: 'b1' }]);
      setupTenant();
    });

    it('P6: responde "cuanto debe la unidad"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([
        {
          amount: 50000,
          paymentAllocations: [],
        },
      ]);

      const result = await (service as any).tryResolveStrictUnitDebtQuestion(
        'tenant-1',
        'Cuanto debe la unidad 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('500');
      expect(result.answer).toContain('deuda pendiente');
    });

    it('P7: responde "deuda del departamento"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([
        {
          amount: 100000,
          paymentAllocations: [
            { amount: 30000, payment: { status: PaymentStatus.APPROVED } },
          ],
        },
      ]);

      const result = await (service as any).tryResolveStrictUnitDebtQuestion(
        'tenant-1',
        'Deuda del departamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('700');
    });

    it('P8: responde "saldo pendiente del apartamento"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictUnitDebtQuestion(
        'tenant-1',
        'Que saldo pendiente tiene el apartamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('no tiene deuda pendiente');
    });

    it('P9: responde "cuanto adeuda el local"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([
        {
          amount: 150000,
          paymentAllocations: [],
        },
      ]);

      const result = await (service as any).tryResolveStrictUnitDebtQuestion(
        'tenant-1',
        'Cuanto adeuda el local 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('1.500');
    });

    it('P10: responde "la unidad tiene deuda"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([
        {
          amount: 0,
          paymentAllocations: [],
        },
      ]);

      const result = await (service as any).tryResolveStrictUnitDebtQuestion(
        'tenant-1',
        'La unidad 101 tiene deuda del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('no tiene deuda pendiente');
    });

    it('P6-F1: sin deuda', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictUnitDebtQuestion(
        'tenant-1',
        'Cuanto debe la unidad 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result.answer).toContain('no tiene deuda pendiente');
    });
  });

  // ============================================================
  // 3. DOCUMENTOS (Unit-level)
  // ============================================================

  describe('3. Documentos (Unit-level)', () => {
    beforeEach(() => {
      setupBuildings([{ id: 'b1', name: 'Edificio A' }]);
      setupUnits([{ id: 'u1', code: '101', label: 'Departamento 101', buildingId: 'b1' }]);
    });

    it('P11: responde "documentos del departamento"', async () => {
      mockPrisma.document.findMany.mockResolvedValue([
        { title: 'Contrato 2024', category: 'CONTRACT' },
        { title: 'Recibo Enero', category: 'RECEIPT' },
      ]);

      const result = await (service as any).tryResolveStrictUnitDocumentsQuestion(
        'tenant-1',
        'Documentos del departamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Contrato 2024');
      expect(result.answer).toContain('Recibo Enero');
    });

    it('P12: responde "que archivos tiene la unidad"', async () => {
      mockPrisma.document.findMany.mockResolvedValue([
        { title: 'Factura', category: 'INVOICE' },
      ]);

      const result = await (service as any).tryResolveStrictUnitDocumentsQuestion(
        'tenant-1',
        'Que archivos tiene la unidad 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Factura');
    });

    it('P13: responde "pdfs del apartamento"', async () => {
      mockPrisma.document.findMany.mockResolvedValue([
        { title: 'Acta', category: 'MINUTES' },
      ]);

      const result = await (service as any).tryResolveStrictUnitDocumentsQuestion(
        'tenant-1',
        'PDFs del apartamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Acta');
    });

    it('P14: responde "comprobantes del local"', async () => {
      mockPrisma.document.findMany.mockResolvedValue([
        { title: 'Comprobante 1', category: 'VOUCHER' },
      ]);

      const result = await (service as any).tryResolveStrictUnitDocumentsQuestion(
        'tenant-1',
        'Comprobantes del local 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Comprobante 1');
    });

    it('P15: responde "documentos de la cochera"', async () => {
      mockPrisma.document.findMany.mockResolvedValue([
        { title: 'Cochera Doc', category: 'OTHER' },
      ]);

      const result = await (service as any).tryResolveStrictUnitDocumentsQuestion(
        'tenant-1',
        'Documentos de la cochera 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Cochera Doc');
    });

    it('P11-F1: sin documentos', async () => {
      mockPrisma.document.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictUnitDocumentsQuestion(
        'tenant-1',
        'Documentos del departamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result.answer).toContain('no tiene documentos registrados');
    });
  });

  // ============================================================
  // 4. TICKETS (Unit-level)
  // ============================================================

  describe('4. Tickets / Reclamos (Unit-level)', () => {
    beforeEach(() => {
      setupBuildings([{ id: 'b1', name: 'Edificio A' }]);
      setupUnits([{ id: 'u1', code: '101', label: 'Departamento 101', buildingId: 'b1' }]);
    });

    it('P16: responde "tickets del departamento"', async () => {
      mockPrisma.ticket.count.mockResolvedValue(1);
      mockPrisma.ticket.findMany.mockResolvedValue([
        { title: 'Fuga de agua', status: 'OPEN' },
      ]);

      const result = await (service as any).tryResolveStrictUnitTicketsQuestion(
        'tenant-1',
        'Tickets del departamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Fuga de agua');
      expect(result.answer).toContain('OPEN');
    });

    it('P17: responde "hay reclamos en la unidad"', async () => {
      mockPrisma.ticket.count.mockResolvedValue(0);
      mockPrisma.ticket.findMany.mockResolvedValue([
        { title: 'Luz fallada', status: 'CLOSED' },
      ]);

      const result = await (service as any).tryResolveStrictUnitTicketsQuestion(
        'tenant-1',
        'Hay reclamos en la unidad 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Luz fallada');
    });

    it('P18: responde "problemas del apartamento"', async () => {
      mockPrisma.ticket.count.mockResolvedValue(2);
      mockPrisma.ticket.findMany.mockResolvedValue([
        { title: 'Ascensor roto', status: 'OPEN' },
        { title: 'Pintura', status: 'IN_PROGRESS' },
      ]);

      const result = await (service as any).tryResolveStrictUnitTicketsQuestion(
        'tenant-1',
        'Problemas del apartamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Ascensor roto');
      expect(result.answer).toContain('(2 abiertos)');
    });

    it('P19: responde "averias del local"', async () => {
      mockPrisma.ticket.count.mockResolvedValue(0);
      mockPrisma.ticket.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictUnitTicketsQuestion(
        'tenant-1',
        'Averias del local 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('no tiene tickets registrados');
    });

    it('P20: responde "que tickets tiene la cochera"', async () => {
      mockPrisma.ticket.count.mockResolvedValue(1);
      mockPrisma.ticket.findMany.mockResolvedValue([
        { title: 'Portón dañado', status: 'OPEN' },
      ]);

      const result = await (service as any).tryResolveStrictUnitTicketsQuestion(
        'tenant-1',
        'Que tickets tiene la cochera 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Portón dañado');
    });
  });

  // ============================================================
  // 5. PAGOS (Unit-level)
  // ============================================================

  describe('5. Pagos Recientes (Unit-level)', () => {
    beforeEach(() => {
      setupBuildings([{ id: 'b1', name: 'Edificio A' }]);
      setupUnits([{ id: 'u1', code: '101', label: 'Departamento 101', buildingId: 'b1' }]);
    });

    it('P21: responde "ultimos pagos del departamento"', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        { amount: 50000, currency: 'ARS', status: 'APPROVED', method: 'TRANSFER', paidAt: new Date('2024-01-15'), createdAt: new Date('2024-01-15') },
      ]);

      const result = await (service as any).tryResolveStrictUnitPaymentsQuestion(
        'tenant-1',
        'Ultimos pagos del departamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('500');
      expect(result.answer).toContain('APPROVED');
    });

    it('P22: responde "historial de pagos de la unidad"', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        { amount: 30000, currency: 'ARS', status: 'RECONCILED', method: 'CASH', paidAt: new Date('2024-01-10'), createdAt: new Date('2024-01-10') },
      ]);

      const result = await (service as any).tryResolveStrictUnitPaymentsQuestion(
        'tenant-1',
        'Historial de pagos de la unidad 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('RECONCILED');
    });

    it('P23: responde "pagos recientes del apartamento"', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictUnitPaymentsQuestion(
        'tenant-1',
        'Pagos recientes del apartamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('no tiene pagos registrados');
    });

    it('P24: responde "historial de transferencias del local"', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        { amount: 75000, currency: 'ARS', status: 'APPROVED', method: 'TRANSFER', paidAt: new Date('2024-01-20'), createdAt: new Date('2024-01-20') },
      ]);

      const result = await (service as any).tryResolveStrictUnitPaymentsQuestion(
        'tenant-1',
        'Historial de transferencias del local 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('750');
    });

    it('P25: responde "recibos recientes de la cochera"', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        { amount: 20000, currency: 'ARS', status: 'APPROVED', method: 'CASH', paidAt: new Date('2024-01-05'), createdAt: new Date('2024-01-05') },
      ]);

      const result = await (service as any).tryResolveStrictUnitPaymentsQuestion(
        'tenant-1',
        'Recibos recientes de la cochera 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('200');
    });

    it('P25-V1: matchea "ultimas transferencias"', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        { amount: 40000, currency: 'ARS', status: 'APPROVED', method: 'TRANSFER', paidAt: new Date('2024-01-06'), createdAt: new Date('2024-01-06') },
      ]);

      const result = await (service as any).tryResolveStrictUnitPaymentsQuestion(
        'tenant-1',
        'Ultimas transferencias del departamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('400');
    });

    it('P25-V2: matchea "movimientos"', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        { amount: 60000, currency: 'ARS', status: 'RECONCILED', method: 'CASH', paidAt: new Date('2024-01-07'), createdAt: new Date('2024-01-07') },
      ]);

      const result = await (service as any).tryResolveStrictUnitPaymentsQuestion(
        'tenant-1',
        'Movimientos del departamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('600');
    });
  });

  // ============================================================
  // 6. DEUDA (Building-level)
  // ============================================================

  describe('6. Deuda Total del Edificio', () => {
    beforeEach(() => {
      setupBuildings([{ id: 'b1', name: 'Edificio A' }]);
      setupUnits([
        { id: 'u1', code: '101', label: 'Dpto 101' },
        { id: 'u2', code: '102', label: 'Dpto 102' },
      ]);
      setupTenant();
    });

    it('P26: responde "cuanto debe el edificio"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([
        { amount: 100000, unitId: 'u1', paymentAllocations: [] },
        { amount: 50000, unitId: 'u2', paymentAllocations: [] },
      ]);

      const result = await (service as any).tryResolveStrictBuildingDebtQuestion(
        'tenant-1',
        'Cuanto debe el Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('1.500');
      expect(result.answer).toContain('2 unidades');
    });

    it('P27: responde "deuda de la torre"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([
        { amount: 200000, unitId: 'u1', paymentAllocations: [] },
      ]);

      const result = await (service as any).tryResolveStrictBuildingDebtQuestion(
        'tenant-1',
        'Deuda de la Torre A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('2.000');
    });

    it('P28: responde "saldo pendiente del bloque"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictBuildingDebtQuestion(
        'tenant-1',
        'Que saldo pendiente tiene el bloque A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('no tiene deuda pendiente');
    });

    it('P29: responde "cuanto adeuda el sector"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([
        { amount: 75000, unitId: 'u1', paymentAllocations: [{ amount: 25000, payment: { status: PaymentStatus.APPROVED } }] },
      ]);

      const result = await (service as any).tryResolveStrictBuildingDebtQuestion(
        'tenant-1',
        'Cuanto adeuda el sector A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('500');
    });

    it('P30: responde "deuda del complejo"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([
        { amount: 0, unitId: 'u1', paymentAllocations: [] },
      ]);

      const result = await (service as any).tryResolveStrictBuildingDebtQuestion(
        'tenant-1',
        'Deuda del complejo A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('no tiene deuda pendiente');
    });
  });

  // ============================================================
  // 7. TICKETS (Building-level)
  // ============================================================

  describe('7. Tickets del Edificio', () => {
    beforeEach(() => {
      setupBuildings([{ id: 'b1', name: 'Edificio A' }]);
    });

    it('P31: responde "tickets del edificio"', async () => {
      mockPrisma.ticket.count.mockResolvedValue(2);
      mockPrisma.ticket.findMany.mockResolvedValue([
        { title: 'Fuga agua', status: 'OPEN', priority: 'HIGH', unitId: 'u1', createdAt: new Date() },
        { title: 'Ascensor', status: 'OPEN', priority: 'MEDIUM', unitId: 'u2', createdAt: new Date() },
      ]);

      const result = await (service as any).tryResolveStrictBuildingTicketsQuestion(
        'tenant-1',
        'Tickets del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Fuga agua');
      expect(result.answer).toContain('(2 abiertos)');
    });

    it('P32: responde "reclamos de la torre"', async () => {
      mockPrisma.ticket.count.mockResolvedValue(0);
      mockPrisma.ticket.findMany.mockResolvedValue([
        { title: 'Pintura', status: 'CLOSED', priority: 'LOW', unitId: 'u1', createdAt: new Date() },
      ]);

      const result = await (service as any).tryResolveStrictBuildingTicketsQuestion(
        'tenant-1',
        'Reclamos de la Torre A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Pintura');
    });

    it('P33: responde "problemas del bloque"', async () => {
      mockPrisma.ticket.count.mockResolvedValue(1);
      mockPrisma.ticket.findMany.mockResolvedValue([
        { title: 'Caldera', status: 'OPEN', priority: 'HIGH', unitId: 'u1', createdAt: new Date() },
      ]);

      const result = await (service as any).tryResolveStrictBuildingTicketsQuestion(
        'tenant-1',
        'Problemas del bloque A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Caldera');
    });

    it('P34: responde "averias del sector"', async () => {
      mockPrisma.ticket.count.mockResolvedValue(0);
      mockPrisma.ticket.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictBuildingTicketsQuestion(
        'tenant-1',
        'Averias del sector A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('no tiene tickets registrados');
    });

    it('P35: responde "hay tickets en el complejo"', async () => {
      mockPrisma.ticket.count.mockResolvedValue(3);
      mockPrisma.ticket.findMany.mockResolvedValue([
        { title: 'A', status: 'OPEN', priority: 'LOW', unitId: 'u1', createdAt: new Date() },
        { title: 'B', status: 'OPEN', priority: 'LOW', unitId: 'u2', createdAt: new Date() },
        { title: 'C', status: 'CLOSED', priority: 'LOW', unitId: 'u3', createdAt: new Date() },
      ]);

      const result = await (service as any).tryResolveStrictBuildingTicketsQuestion(
        'tenant-1',
        'Hay tickets en el complejo A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('(3 abiertos)');
    });

    it('P35-V1: matchea "fallas del edificio"', async () => {
      mockPrisma.ticket.count.mockResolvedValue(1);
      mockPrisma.ticket.findMany.mockResolvedValue([
        { title: 'Luz cortada', status: 'OPEN', priority: 'HIGH', unitId: 'u1', createdAt: new Date() },
      ]);

      const result = await (service as any).tryResolveStrictBuildingTicketsQuestion(
        'tenant-1',
        'Fallas del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Luz cortada');
    });

    it('P35-V2: matchea "reparaciones del edificio"', async () => {
      mockPrisma.ticket.count.mockResolvedValue(0);
      mockPrisma.ticket.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictBuildingTicketsQuestion(
        'tenant-1',
        'Reparaciones del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('no tiene tickets registrados');
    });
  });

  // ============================================================
  // 8. MOROSOS / TOP DEUDORES (Building-level)
  // ============================================================

  describe('8. Morosos / Top Deudores', () => {
    beforeEach(() => {
      setupBuildings([{ id: 'b1', name: 'Edificio A' }]);
      setupUnits([
        { id: 'u1', code: '101', label: 'Dpto 101' },
        { id: 'u2', code: '102', label: 'Dpto 102' },
        { id: 'u3', code: '103', label: 'Dpto 103' },
      ]);
      setupTenant();
    });

    it('P36: responde "quienes son los morosos"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([
        { amount: 100000, unitId: 'u1', paymentAllocations: [] },
        { amount: 50000, unitId: 'u2', paymentAllocations: [] },
      ]);

      const result = await (service as any).tryResolveStrictBuildingDelinquentsQuestion(
        'tenant-1',
        'Quienes son los morosos del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Top deudores');
      expect(result.answer).toContain('Dpto 101');
      expect(result.answer).toContain('1.000');
      expect(result.answer).toContain('Dpto 102');
      expect(result.answer).toContain('500');
    });

    it('P37: responde "top deudores de la torre"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([
        { amount: 200000, unitId: 'u1', paymentAllocations: [] },
      ]);

      const result = await (service as any).tryResolveStrictBuildingDelinquentsQuestion(
        'tenant-1',
        'Top deudores de la Torre A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Top deudores');
    });

    it('P38: responde "ranking de deuda del bloque"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([
        { amount: 150000, unitId: 'u1', paymentAllocations: [{ amount: 50000, payment: { status: PaymentStatus.APPROVED } }] },
        { amount: 80000, unitId: 'u2', paymentAllocations: [] },
      ]);

      const result = await (service as any).tryResolveStrictBuildingDelinquentsQuestion(
        'tenant-1',
        'Ranking de deuda del bloque A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Dpto 102'); // 800 > 100
    });

    it('P39: responde "quien debe en el sector"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictBuildingDelinquentsQuestion(
        'tenant-1',
        'Quien debe en el sector A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('no tiene unidades con deuda pendiente');
    });

    it('P40: responde "morosos del complejo"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([
        { amount: 300000, unitId: 'u1', paymentAllocations: [] },
        { amount: 200000, unitId: 'u2', paymentAllocations: [] },
        { amount: 100000, unitId: 'u3', paymentAllocations: [] },
      ]);

      const result = await (service as any).tryResolveStrictBuildingDelinquentsQuestion(
        'tenant-1',
        'Morosos del complejo A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Dpto 101');
      expect(result.answer).toContain('Dpto 102');
      expect(result.answer).toContain('Dpto 103');
    });

    it('P41: responde "deudores del edificio"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([
        { amount: 50000, unitId: 'u1', paymentAllocations: [] },
      ]);

      const result = await (service as any).tryResolveStrictBuildingDelinquentsQuestion(
        'tenant-1',
        'Deudores del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Top deudores');
    });

    it('P41-V1: matchea "atrasados"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([
        { amount: 80000, unitId: 'u1', paymentAllocations: [] },
      ]);

      const result = await (service as any).tryResolveStrictBuildingDelinquentsQuestion(
        'tenant-1',
        'Atrasados del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Top deudores');
    });

    it('P41-V2: matchea "impagos"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictBuildingDelinquentsQuestion(
        'tenant-1',
        'Impagos del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('no tiene unidades con deuda pendiente');
    });
  });

  // ============================================================
  // 9. ESTADÍSTICAS DEL EDIFICIO
  // ============================================================

  describe('9. Estadísticas del Edificio', () => {
    beforeEach(() => {
      setupBuildings([{ id: 'b1', name: 'Edificio A' }]);
      setupUnits([
        { id: 'u1', code: '101', label: 'Dpto 101' },
        { id: 'u2', code: '102', label: 'Dpto 102' },
      ]);
      setupTenant();
    });

    it('P42: responde "estadisticas del edificio"', async () => {
      mockPrisma.ticket.count.mockResolvedValueOnce(2).mockResolvedValueOnce(5);
      mockPrisma.charge.findMany.mockResolvedValue([
        { amount: 100000, unitId: 'u1', paymentAllocations: [] },
        { amount: 50000, unitId: 'u2', paymentAllocations: [] },
      ]);

      const result = await (service as any).tryResolveStrictBuildingStatsQuestion(
        'tenant-1',
        'Estadisticas del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Unidades: 2');
      expect(result.answer).toContain('Tickets abiertos: 2 de 5 totales');
      expect(result.answer).toContain('Deuda total');
      expect(result.answer).toContain('Deuda promedio por unidad');
    });

    it('P43: responde "cuantas unidades tiene la torre"', async () => {
      mockPrisma.ticket.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      mockPrisma.charge.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictBuildingStatsQuestion(
        'tenant-1',
        'Cuantas unidades tiene la Torre A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Unidades: 2');
    });

    it('P44: responde "resumen del bloque"', async () => {
      mockPrisma.ticket.count.mockResolvedValueOnce(1).mockResolvedValueOnce(3);
      mockPrisma.charge.findMany.mockResolvedValue([
        { amount: 200000, unitId: 'u1', paymentAllocations: [{ amount: 100000, payment: { status: PaymentStatus.APPROVED } }] },
      ]);

      const result = await (service as any).tryResolveStrictBuildingStatsQuestion(
        'tenant-1',
        'Resumen del bloque A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Deuda total');
    });

    it('P45: responde "informacion del edificio"', async () => {
      mockPrisma.ticket.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      mockPrisma.charge.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictBuildingStatsQuestion(
        'tenant-1',
        'Informacion del edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Estadísticas del edificio');
    });

    it('P46: responde "datos del edificio"', async () => {
      mockPrisma.ticket.count.mockResolvedValueOnce(5).mockResolvedValueOnce(10);
      mockPrisma.charge.findMany.mockResolvedValue([
        { amount: 300000, unitId: 'u1', paymentAllocations: [] },
        { amount: 100000, unitId: 'u2', paymentAllocations: [] },
      ]);

      const result = await (service as any).tryResolveStrictBuildingStatsQuestion(
        'tenant-1',
        'Datos del edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Deuda total');
      expect(result.answer).toContain('Deuda promedio por unidad');
    });

    it('P47: responde "estadisticas del edificio" (variante)', async () => {
      mockPrisma.ticket.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      mockPrisma.charge.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictBuildingStatsQuestion(
        'tenant-1',
        'Estadisticas del edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Estadísticas del edificio');
    });

    it('P47-V1: matchea "como viene el edificio"', async () => {
      mockPrisma.ticket.count.mockResolvedValueOnce(2).mockResolvedValueOnce(8);
      mockPrisma.charge.findMany.mockResolvedValue([
        { amount: 100000, unitId: 'u1', paymentAllocations: [] },
      ]);

      const result = await (service as any).tryResolveStrictBuildingStatsQuestion(
        'tenant-1',
        'Como viene el edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Estadísticas del edificio');
      expect(result.answer).toContain('Deuda total');
    });

    it('P47-V2: matchea "cuentas del edificio"', async () => {
      mockPrisma.ticket.count.mockResolvedValueOnce(0).mockResolvedValueOnce(3);
      mockPrisma.charge.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictBuildingStatsQuestion(
        'tenant-1',
        'Cuentas del edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Estadísticas del edificio');
    });
  });

  // ============================================================
  // 10. DOCUMENTOS (Building-level)
  // ============================================================

  describe('10. Documentos del Edificio', () => {
    beforeEach(() => {
      setupBuildings([{ id: 'b1', name: 'Edificio A' }]);
    });

    it('P48: responde "documentos del edificio"', async () => {
      mockPrisma.document.findMany.mockResolvedValue([
        { title: 'Reglamento', category: 'RULES' },
        { title: 'Acta Asamblea', category: 'MINUTES' },
      ]);

      const result = await (service as any).tryResolveStrictBuildingDocumentsQuestion(
        'tenant-1',
        'Documentos del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Reglamento');
      expect(result.answer).toContain('Acta Asamblea');
    });

    it('P49: responde "archivos de la torre"', async () => {
      mockPrisma.document.findMany.mockResolvedValue([
        { title: 'Planos', category: 'BLUEPRINT' },
      ]);

      const result = await (service as any).tryResolveStrictBuildingDocumentsQuestion(
        'tenant-1',
        'Archivos de la Torre A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Planos');
    });

    it('P50: responde "pdfs del bloque"', async () => {
      mockPrisma.document.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictBuildingDocumentsQuestion(
        'tenant-1',
        'PDFs del bloque A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('no tiene documentos registrados');
    });

    it('P51: responde "comprobantes del sector"', async () => {
      mockPrisma.document.findMany.mockResolvedValue([
        { title: 'Comprobante 1', category: 'VOUCHER' },
        { title: 'Comprobante 2', category: 'VOUCHER' },
      ]);

      const result = await (service as any).tryResolveStrictBuildingDocumentsQuestion(
        'tenant-1',
        'Comprobantes del sector A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Comprobante 1');
      expect(result.answer).toContain('Comprobante 2');
    });

    it('P52: responde "documentos del complejo"', async () => {
      mockPrisma.document.findMany.mockResolvedValue([
        { title: 'Manual', category: 'OTHER' },
      ]);

      const result = await (service as any).tryResolveStrictBuildingDocumentsQuestion(
        'tenant-1',
        'Documentos del complejo A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Manual');
    });

    it('P52-V1: matchea "actas del edificio"', async () => {
      mockPrisma.document.findMany.mockResolvedValue([
        { title: 'Acta Asamblea 2024', category: 'MINUTES' },
      ]);

      const result = await (service as any).tryResolveStrictBuildingDocumentsQuestion(
        'tenant-1',
        'Actas del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Acta Asamblea 2024');
    });

    it('P52-V2: matchea "expedientes del edificio"', async () => {
      mockPrisma.document.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictBuildingDocumentsQuestion(
        'tenant-1',
        'Expedientes del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('no tiene documentos registrados');
    });
  });

  // ============================================================
  // 11. PAGOS (Building-level)
  // ============================================================

  describe('11. Pagos del Edificio', () => {
    beforeEach(() => {
      setupBuildings([{ id: 'b1', name: 'Edificio A' }]);
      setupUnits([
        { id: 'u1', code: '101', label: 'Dpto 101' },
        { id: 'u2', code: '102', label: 'Dpto 102' },
      ]);
    });

    it('P53: responde "pagos del edificio"', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        { amount: 50000, currency: 'ARS', status: 'APPROVED', method: 'TRANSFER', paidAt: new Date('2024-01-15'), createdAt: new Date('2024-01-15'), unitId: 'u1' },
        { amount: 30000, currency: 'ARS', status: 'RECONCILED', method: 'CASH', paidAt: new Date('2024-01-10'), createdAt: new Date('2024-01-10'), unitId: 'u2' },
      ]);

      const result = await (service as any).tryResolveStrictBuildingPaymentsQuestion(
        'tenant-1',
        'Pagos del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Ultimos pagos');
      expect(result.answer).toContain('Dpto 101');
      expect(result.answer).toContain('Dpto 102');
    });

    it('P54: responde "ultimas transferencias de la torre"', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        { amount: 100000, currency: 'ARS', status: 'APPROVED', method: 'TRANSFER', paidAt: new Date('2024-01-20'), createdAt: new Date('2024-01-20'), unitId: 'u1' },
      ]);

      const result = await (service as any).tryResolveStrictBuildingPaymentsQuestion(
        'tenant-1',
        'Ultimas transferencias de la Torre A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('1.000');
    });

    it('P55: responde "recibos del bloque"', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictBuildingPaymentsQuestion(
        'tenant-1',
        'Recibos del bloque A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('no tiene pagos registrados');
    });

    it('P56: responde "pagos recientes del sector"', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        { amount: 25000, currency: 'ARS', status: 'APPROVED', method: 'CASH', paidAt: new Date('2024-01-05'), createdAt: new Date('2024-01-05'), unitId: 'u2' },
      ]);

      const result = await (service as any).tryResolveStrictBuildingPaymentsQuestion(
        'tenant-1',
        'Pagos recientes del sector A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('250');
    });

    it('P57: responde "transferencias del complejo"', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        { amount: 75000, currency: 'ARS', status: 'APPROVED', method: 'TRANSFER', paidAt: new Date('2024-01-18'), createdAt: new Date('2024-01-18'), unitId: 'u1' },
      ]);

      const result = await (service as any).tryResolveStrictBuildingPaymentsQuestion(
        'tenant-1',
        'Transferencias del complejo A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('750');
    });

    it('P57-V1: matchea "cobranzas del edificio"', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        { amount: 90000, currency: 'ARS', status: 'APPROVED', method: 'TRANSFER', paidAt: new Date('2024-01-22'), createdAt: new Date('2024-01-22'), unitId: 'u2' },
      ]);

      const result = await (service as any).tryResolveStrictBuildingPaymentsQuestion(
        'tenant-1',
        'Cobranzas del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('900');
    });

    it('P57-V2: matchea "recibos del edificio"', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictBuildingPaymentsQuestion(
        'tenant-1',
        'Recibos del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('no tiene pagos registrados');
    });
  });

  // ============================================================
  // 12. SEGURIDAD / ROLES
  // ============================================================

  describe('12. Seguridad - Control de Acceso', () => {
    it('bloquea residentes en consultas operativas', async () => {
      const residentRoles = ['RESIDENT'];

      const debtResult = await (service as any).tryResolveStrictUnitDebtQuestion(
        'tenant-1',
        'Cuanto debe la unidad 101 del Edificio A',
        residentRoles,
      );

      expect(debtResult).toBeNull();
    });

    it('bloquea guests en consultas operativas', async () => {
      const guestRoles = ['GUEST'];

      const ticketResult = await (service as any).tryResolveStrictBuildingTicketsQuestion(
        'tenant-1',
        'Tickets del Edificio A',
        guestRoles,
      );

      expect(ticketResult).toBeNull();
    });

    it('permite SUPER_ADMIN', async () => {
      setupBuildings([{ id: 'b1', name: 'Edificio A' }]);
      setupUnits([{ id: 'u1', code: '101', label: null, buildingId: 'b1' }]);
      setupTenant();
      mockPrisma.charge.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictUnitDebtQuestion(
        'tenant-1',
        'Cuanto debe la unidad 101 del Edificio A',
        ['SUPER_ADMIN'],
      );

      expect(result).not.toBeNull();
    });

    it('permite TENANT_OWNER', async () => {
      setupBuildings([{ id: 'b1', name: 'Edificio A' }]);
      setupUnits([{ id: 'u1', code: '101', label: null, buildingId: 'b1' }]);
      setupTenant();
      mockPrisma.charge.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictUnitDebtQuestion(
        'tenant-1',
        'Cuanto debe la unidad 101 del Edificio A',
        ['TENANT_OWNER'],
      );

      expect(result).not.toBeNull();
    });

    it('permite OPERATOR', async () => {
      setupBuildings([{ id: 'b1', name: 'Edificio A' }]);
      setupUnits([{ id: 'u1', code: '101', label: null, buildingId: 'b1' }]);
      setupTenant();
      mockPrisma.charge.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictUnitDebtQuestion(
        'tenant-1',
        'Cuanto debe la unidad 101 del Edificio A',
        ['OPERATOR'],
      );

      expect(result).not.toBeNull();
    });
  });

  // ============================================================
  // 13. PIPELINE INTEGRATION
  // ============================================================

  describe('13. Pipeline Integration', () => {
    beforeEach(() => {
      setupBuildings([{ id: 'b1', name: 'Edificio A' }]);
      setupUnits([{ id: 'u1', code: '101', label: 'Dpto 101', buildingId: 'b1' }]);
      setupTenant();
    });

    it('building-level se evalua antes que unit-level para "deuda edificio A"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([
        { amount: 100000, unitId: 'u1', paymentAllocations: [] },
      ]);

      const result = await (service as any).tryResolveStrictOperationalQuestion(
        'tenant-1',
        'Deuda del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Edificio A');
      expect(result.answer).toContain('deuda total');
    });

    it('unit-level se usa para "deuda del depto 101 del Edificio A"', async () => {
      mockPrisma.charge.findMany.mockResolvedValue([
        { amount: 50000, paymentAllocations: [] },
      ]);

      const result = await (service as any).tryResolveStrictOperationalQuestion(
        'tenant-1',
        'Deuda del depto 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('A-0101');
      expect(result.answer).toContain('deuda pendiente');
    });

    it('retorna null si ninguna query matchea', async () => {
      const result = await (service as any).tryResolveStrictOperationalQuestion(
        'tenant-1',
        'Cual es el clima hoy',
        ADMIN_ROLES,
      );

      expect(result).toBeNull();
    });

    it('pide aclaración cuando la deuda es de un condominio sin edificio concreto', async () => {
      const result = await (service as any).tryResolveStrictOperationalQuestion(
        'tenant-1',
        'deuda condominio',
        ADMIN_ROLES,
        'admin-user',
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('condominio o edificio');
      expect(mockQueryExecutors.execute).not.toHaveBeenCalled();
    });

    it('asks for clarification when debt scope is ambiguous', async () => {
      const result = await (service as any).tryResolveStrictOperationalQuestion(
        'tenant-1',
        'deuda',
        ADMIN_ROLES,
        'admin-user',
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('unidad, un edificio o a la administración');
    });
  });

  // ============================================================
  // 14. BUILDING-LEVEL EDGE CASES
  // ============================================================

  describe('14. Building-Level Edge Cases', () => {
    beforeEach(() => {
      setupBuildings([{ id: 'b1', name: 'Edificio A' }]);
      setupUnits([
        { id: 'u1', code: '101', label: 'Dpto 101' },
        { id: 'u2', code: '102', label: 'Dpto 102' },
      ]);
      setupTenant();
    });

    describe('14.1 Building not found', () => {
      it('debt: retorna error cuando el edificio no existe', async () => {
        const result = await (service as any).tryResolveStrictBuildingDebtQuestion(
          'tenant-1',
          'Cuanto debe la Torre Z',
          ADMIN_ROLES,
        );

        expect(result).not.toBeNull();
        expect(result.answer).toContain('No encontré el edificio');
      });

      it('tickets: retorna error cuando el edificio no existe', async () => {
        const result = await (service as any).tryResolveStrictBuildingTicketsQuestion(
          'tenant-1',
          'Tickets de la Torre Z',
          ADMIN_ROLES,
        );

        expect(result).not.toBeNull();
        expect(result.answer).toContain('No encontré el edificio');
      });

      it('delinquents: retorna error cuando el edificio no existe', async () => {
        const result = await (service as any).tryResolveStrictBuildingDelinquentsQuestion(
          'tenant-1',
          'Morosos de la Torre Z',
          ADMIN_ROLES,
        );

        expect(result).not.toBeNull();
        expect(result.answer).toContain('No encontré el edificio');
      });

      it('stats: retorna error cuando el edificio no existe', async () => {
        const result = await (service as any).tryResolveStrictBuildingStatsQuestion(
          'tenant-1',
          'Estadisticas de la Torre Z',
          ADMIN_ROLES,
        );

        expect(result).not.toBeNull();
        expect(result.answer).toContain('No encontré el edificio');
      });

      it('documents: retorna error cuando el edificio no existe', async () => {
        const result = await (service as any).tryResolveStrictBuildingDocumentsQuestion(
          'tenant-1',
          'Documentos de la Torre Z',
          ADMIN_ROLES,
        );

        expect(result).not.toBeNull();
        expect(result.answer).toContain('No encontré el edificio');
      });

      it('payments: retorna error cuando el edificio no existe', async () => {
        const result = await (service as any).tryResolveStrictBuildingPaymentsQuestion(
          'tenant-1',
          'Pagos de la Torre Z',
          ADMIN_ROLES,
        );

        expect(result).not.toBeNull();
        expect(result.answer).toContain('No encontré el edificio');
      });
    });

    describe('14.2 Unit token present blocks building-level', () => {
      it('debt: retorna null si hay unitToken (va a unit-level)', async () => {
        mockPrisma.charge.findMany.mockResolvedValue([]);

        const result = await (service as any).tryResolveStrictBuildingDebtQuestion(
          'tenant-1',
          'Cuanto debe el departamento 0101 del Edificio A',
          ADMIN_ROLES,
        );

        expect(result).toBeNull();
      });

      it('tickets: retorna null si hay unitToken (va a unit-level)', async () => {
        mockPrisma.ticket.findMany.mockResolvedValue([]);

        const result = await (service as any).tryResolveStrictBuildingTicketsQuestion(
          'tenant-1',
          'Tickets del departamento 0101 del Edificio A',
          ADMIN_ROLES,
        );

        expect(result).toBeNull();
      });

      it('delinquents: retorna null si hay unitToken (va a unit-level)', async () => {
        mockPrisma.charge.findMany.mockResolvedValue([]);

        const result = await (service as any).tryResolveStrictBuildingDelinquentsQuestion(
          'tenant-1',
          'Morosos del departamento 0101 del Edificio A',
          ADMIN_ROLES,
        );

        expect(result).toBeNull();
      });

      it('stats: retorna null si hay unitToken (va a unit-level)', async () => {
        mockPrisma.charge.findMany.mockResolvedValue([]);

        const result = await (service as any).tryResolveStrictBuildingStatsQuestion(
          'tenant-1',
          'Estadisticas del departamento 0101 del Edificio A',
          ADMIN_ROLES,
        );

        expect(result).toBeNull();
      });

      it('documents: retorna null si hay unitToken (va a unit-level)', async () => {
        mockPrisma.document.findMany.mockResolvedValue([]);

        const result = await (service as any).tryResolveStrictBuildingDocumentsQuestion(
          'tenant-1',
          'Documentos del departamento 0101 del Edificio A',
          ADMIN_ROLES,
        );

        expect(result).toBeNull();
      });

      it('payments: retorna null si hay unitToken (va a unit-level)', async () => {
        mockPrisma.payment.findMany.mockResolvedValue([]);

        const result = await (service as any).tryResolveStrictBuildingPaymentsQuestion(
          'tenant-1',
          'Pagos del departamento 0101 del Edificio A',
          ADMIN_ROLES,
        );

        expect(result).toBeNull();
      });
    });

    describe('14.3 Role-based access per building-level method', () => {
      it('delinquents: bloquea RESIDENT', async () => {
        const result = await (service as any).tryResolveStrictBuildingDelinquentsQuestion(
          'tenant-1',
          'Morosos del Edificio A',
          ['RESIDENT'],
        );

        expect(result).toBeNull();
      });

      it('stats: bloquea GUEST', async () => {
        const result = await (service as any).tryResolveStrictBuildingStatsQuestion(
          'tenant-1',
          'Estadisticas del Edificio A',
          ['GUEST'],
        );

        expect(result).toBeNull();
      });

      it('documents: permite OPERATOR', async () => {
        mockPrisma.document.findMany.mockResolvedValue([]);

        const result = await (service as any).tryResolveStrictBuildingDocumentsQuestion(
          'tenant-1',
          'Documentos del Edificio A',
          ['OPERATOR'],
        );

        expect(result).not.toBeNull();
      });

      it('payments: permite TENANT_OWNER', async () => {
        mockPrisma.payment.findMany.mockResolvedValue([]);

        const result = await (service as any).tryResolveStrictBuildingPaymentsQuestion(
          'tenant-1',
          'Pagos del Edificio A',
          ['TENANT_OWNER'],
        );

        expect(result).not.toBeNull();
      });
    });

    describe('14.4 Empty data scenarios', () => {
      it('delinquents: sin unidades con deuda retorna mensaje al dia', async () => {
        mockPrisma.charge.findMany.mockResolvedValue([]);

        const result = await (service as any).tryResolveStrictBuildingDelinquentsQuestion(
          'tenant-1',
          'Morosos del Edificio A',
          ADMIN_ROLES,
        );

        expect(result).not.toBeNull();
        expect(result.answer).toContain('no tiene unidades con deuda pendiente');
        expect(result.answer).toContain('están al día');
      });

      it('stats: calcula promedio correcto con deuda cero', async () => {
        mockPrisma.ticket.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
        mockPrisma.charge.findMany.mockResolvedValue([]);

        const result = await (service as any).tryResolveStrictBuildingStatsQuestion(
          'tenant-1',
          'Estadisticas del Edificio A',
          ADMIN_ROLES,
        );

        expect(result).not.toBeNull();
        expect(result.answer).toContain('Deuda promedio por unidad');
      });

      it('payments: sin pagos retorna mensaje vacio', async () => {
        mockPrisma.payment.findMany.mockResolvedValue([]);

        const result = await (service as any).tryResolveStrictBuildingPaymentsQuestion(
          'tenant-1',
          'Pagos del Edificio A',
          ADMIN_ROLES,
        );

        expect(result).not.toBeNull();
        expect(result.answer).toContain('no tiene pagos registrados');
      });
    });
  });

  // ============================================================
  // 15. CLASSIFIER LLM (Nivel 2)
  // ============================================================

  describe('15. Classifier LLM Pipeline', () => {
    beforeEach(() => {
      setupBuildings([{ id: 'b1', name: 'Edificio A' }]);
      setupUnits([{ id: 'u1', code: '101', label: 'Dpto 101', buildingId: 'b1' }]);
      setupTenant();
    });

    it('C1: buildClassifierSuggestionResponse con DEBT', async () => {
      const result = await (service as any).buildClassifierSuggestionResponse(
        { category: 'DEBT', confidence: 0.92 },
        'b1',
        'u1',
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('deudas');
      expect(result.suggestedActions[0].type).toBe('VIEW_PAYMENTS');
      expect(result.suggestedActions[0].payload.buildingId).toBe('b1');
      expect(result.suggestedActions[0].payload.unitId).toBe('u1');
    });

    it('C2: buildClassifierSuggestionResponse con TICKETS', async () => {
      const result = await (service as any).buildClassifierSuggestionResponse(
        { category: 'TICKETS', confidence: 0.88 },
        'b1',
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('tickets');
      expect(result.suggestedActions[0].type).toBe('VIEW_TICKETS');
      expect(result.suggestedActions[0].payload.buildingId).toBe('b1');
    });

    it('C3: buildClassifierSuggestionResponse con DOCUMENTS sin contexto', async () => {
      const result = await (service as any).buildClassifierSuggestionResponse(
        { category: 'DOCUMENTS', confidence: 0.90 },
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('documentos');
      expect(result.suggestedActions[0].type).toBe('VIEW_DOCUMENTS');
      expect(result.suggestedActions[0].payload).toEqual({});
    });

    it('C4: buildClassifierSuggestionResponse con STATS', async () => {
      const result = await (service as any).buildClassifierSuggestionResponse(
        { category: 'STATS', confidence: 0.85 },
        'b1',
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('estadísticas');
      expect(result.suggestedActions[0].type).toBe('VIEW_REPORTS');
    });

    it('C5: buildClassifierSuggestionResponse con GENERAL (default)', async () => {
      const result = await (service as any).buildClassifierSuggestionResponse(
        { category: 'UNKNOWN' as any, confidence: 0.50 },
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Entendí');
      expect(result.suggestedActions[0].type).toBe('VIEW_REPORTS');
    });

    it('C6: strict funciona, classifier NO se ejecuta', async () => {
      mockPrisma.unitOccupant.findMany.mockResolvedValue([
        { isPrimary: true, role: 'OWNER', member: { id: 'm1', name: 'Juan Perez' } },
      ]);
      mockClassifier.classify.mockResolvedValue({ category: 'RESIDENTS', confidence: 0.99 });

      const result = await (service as any).tryResolveStrictOperationalQuestion(
        'tenant-1',
        'Quien vive en el departamento 101 del Edificio A',
        ADMIN_ROLES,
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Juan Perez');
      expect(mockClassifier.classify).not.toHaveBeenCalled();
    });
  });

  describe('16. P0 security hardening', () => {
    beforeEach(() => {
      setupBuildings([{ id: 'b1', name: 'Edificio A' }]);
      setupTenant();
    });


    it('uses P1 QueryPlan executor before legacy strict and classifier', async () => {
      const plan = {
        intent: 'unit_debt',
        module: 'payments',
        scope: 'unit',
        requiredPermission: 'payments.review',
        executor: 'unit_debt',
        filters: { unitCode: '0101', buildingAlias: 'A' },
        confidence: 0.92,
        source: 'deterministic_rules',
      };
      mockQueryPlanService.createPlan.mockReturnValue(plan);
      mockQueryExecutors.execute.mockResolvedValue({
        answer: 'Respuesta desde QueryPlan allowlisted',
        suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: { buildingId: 'b1', unitId: 'u1' } }],
      });

      const result = await service.chat(
        'tenant-1',
        'admin-user',
        'membership-admin',
        { message: 'Cuanto debe A-0101', page: 'dashboard' },
        ['TENANT_ADMIN'],
      );

      expect(result.answer).toContain('QueryPlan allowlisted');
      expect(mockQueryPlanService.createPlan).toHaveBeenCalledWith('Cuanto debe A-0101');
      expect(mockQueryExecutors.execute).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'admin-user',
        userRoles: ['TENANT_ADMIN'],
        plan,
      }));
      expect(mockClassifier.classify).not.toHaveBeenCalled();
      expect(mockCache.set).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ answer: expect.stringContaining('QueryPlan allowlisted') }),
        'LIVE_DATA_PLAN',
      );
    });

    it('denies live-data when scoped RBAC rejects the requested building', async () => {
      mockAuthorize.authorize.mockResolvedValue(false);

      const result = await (service as any).tryResolveStrictBuildingDebtQuestion(
        'tenant-1',
        'Deuda del Edificio A',
        ['OPERATOR'],
        'operator-user',
      );

      expect(result).toBeNull();
      expect(mockAuthorize.authorize).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'operator-user',
        tenantId: 'tenant-1',
        permission: 'payments.review',
        buildingId: 'b1',
      }));
      expect(mockPrisma.charge.findMany).not.toHaveBeenCalled();
    });

    it('allows scoped operator to query its building', async () => {
      mockAuthorize.authorize.mockResolvedValue(true);
      mockPrisma.charge.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictBuildingDebtQuestion(
        'tenant-1',
        'Deuda del Edificio A',
        ['OPERATOR'],
        'operator-user',
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Edificio A');
      expect(mockPrisma.charge.findMany).toHaveBeenCalled();
    });

    it('allows tenant-wide admin to query another building', async () => {
      setupBuildings([{ id: 'b2', name: 'Edificio B' }]);
      mockAuthorize.authorize.mockResolvedValue(true);
      mockPrisma.charge.findMany.mockResolvedValue([]);

      const result = await (service as any).tryResolveStrictBuildingDebtQuestion(
        'tenant-1',
        'Deuda del Edificio B',
        ['TENANT_ADMIN'],
        'admin-user',
      );

      expect(result).not.toBeNull();
      expect(result.answer).toContain('Edificio B');
      expect(mockAuthorize.authorize).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'admin-user',
        buildingId: 'b2',
      }));
    });

    it('does not resolve operational live-data for resident role', async () => {
      const result = await (service as any).tryResolveStrictUnitDebtQuestion(
        'tenant-1',
        'Cuanto debe A-0101',
        ['RESIDENT'],
        'resident-user',
      );

      expect(result).toBeNull();
      expect(mockUnitResolver.resolve).not.toHaveBeenCalled();
    });

    it('does not cache strict live-data and does not leak admin answer to resident repeat', async () => {
      mockPrisma.unitOccupant.findMany.mockResolvedValue([
        { isPrimary: true, role: 'OWNER', member: { id: 'm1', name: 'Admin Visible Owner' } },
      ]);
      mockClassifier.classify.mockResolvedValue({ category: 'GENERAL', confidence: 0 });
      mockMockAiProvider.chat.mockResolvedValue({ answer: 'Fallback sin datos sensibles', suggestedActions: [] });

      const adminResult = await service.chat(
        'tenant-1',
        'admin-user',
        'membership-admin',
        { message: 'Quien vive en A-0101', page: 'dashboard' },
        ['TENANT_ADMIN'],
      );
      const residentResult = await service.chat(
        'tenant-1',
        'resident-user',
        'membership-resident',
        { message: 'Quien vive en A-0101', page: 'dashboard' },
        ['RESIDENT'],
      );

      expect(adminResult.answer).toContain('Admin Visible Owner');
      expect(residentResult.answer).not.toContain('Admin Visible Owner');
      expect(mockCache.set).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ answer: expect.stringContaining('Admin Visible Owner') }),
        'LIVE_DATA_STRICT',
      );
    });

    it('loads ticket reply prompt from tenant-scoped DB ticket data', async () => {
      mockPrisma.ticket.findFirst.mockResolvedValue({
        id: 'ticket-1',
        title: 'DB ticket title',
        description: 'DB ticket description',
        buildingId: 'b1',
        unitId: 'u1',
      });
      mockMockAiProvider.chat.mockResolvedValue({
        answer: '1. Primera respuesta\n2. Segunda respuesta\n3. Tercera respuesta',
        suggestedActions: [],
      });

      const result = await service.getTicketReplySuggestions(
        'tenant-1',
        'ticket-1',
        'CLIENT SPOOF TITLE',
        'CLIENT SPOOF DESCRIPTION',
        'admin-user',
        ['TENANT_ADMIN'],
      );

      expect(result).toEqual(['Primera respuesta', 'Segunda respuesta', 'Tercera respuesta']);
      expect(mockPrisma.ticket.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'ticket-1', tenantId: 'tenant-1' },
      }));
      expect(mockAuthorize.authorize).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'admin-user',
        tenantId: 'tenant-1',
        permission: 'tickets.manage',
        buildingId: 'b1',
        unitId: 'u1',
      }));
      const prompt = mockMockAiProvider.chat.mock.calls[0][0] as string;
      expect(prompt).toContain('DB ticket title');
      expect(prompt).toContain('DB ticket description');
      expect(prompt).not.toContain('CLIENT SPOOF TITLE');
      expect(prompt).not.toContain('CLIENT SPOOF DESCRIPTION');
    });

    it('allows operator ticket replies through scoped tickets.read fallback', async () => {
      mockPrisma.ticket.findFirst.mockResolvedValue({
        id: 'ticket-1',
        title: 'DB ticket title',
        description: 'DB ticket description',
        buildingId: 'b1',
        unitId: null,
      });
      mockAuthorize.authorize
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      mockMockAiProvider.chat.mockResolvedValue({
        answer: '1. Primera respuesta\n2. Segunda respuesta\n3. Tercera respuesta',
        suggestedActions: [],
      });

      await expect(service.getTicketReplySuggestions(
        'tenant-1',
        'ticket-1',
        'Title',
        'Description',
        'operator-user',
        ['OPERATOR'],
      )).resolves.toHaveLength(3);

      expect(mockAuthorize.authorize).toHaveBeenNthCalledWith(1, expect.objectContaining({ permission: 'tickets.manage' }));
      expect(mockAuthorize.authorize).toHaveBeenNthCalledWith(2, expect.objectContaining({ permission: 'tickets.read' }));
      expect(mockMockAiProvider.chat).toHaveBeenCalled();
    });

    it('denies ticket reply suggestions for valid role without ticket building scope', async () => {
      mockPrisma.ticket.findFirst.mockResolvedValue({
        id: 'ticket-1',
        title: 'DB ticket title',
        description: 'DB ticket description',
        buildingId: 'b2',
        unitId: null,
      });
      mockAuthorize.authorize.mockResolvedValue(false);

      await expect(service.getTicketReplySuggestions(
        'tenant-1',
        'ticket-1',
        'Title',
        'Description',
        'operator-user',
        ['OPERATOR'],
      )).rejects.toThrow('User is not allowed to generate replies for this ticket');

      expect(mockMockAiProvider.chat).not.toHaveBeenCalled();
    });

    it('rejects ticket reply suggestions for tickets outside tenant scope', async () => {
      mockPrisma.ticket.findFirst.mockResolvedValue(null);

      await expect(
        service.getTicketReplySuggestions('tenant-1', 'foreign-ticket', 'Title', 'Description', 'admin-user', ['TENANT_ADMIN']),
      ).rejects.toThrow('Ticket not found for tenant');

      expect(mockMockAiProvider.chat).not.toHaveBeenCalled();
    });
  });

});
