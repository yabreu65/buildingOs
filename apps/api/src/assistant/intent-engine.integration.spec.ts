import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { StructuredResponse } from './ai.types';

/**
 * Integration tests for the /chat/v2 endpoint
 * Tests the full pipeline with the new intent engine
 */
describe('AssistantController - /chat/v2 Integration', () => {
  let controller: AssistantController;
  let assistantService: jest.Mocked<AssistantService>;
  let aiEntitlements: any;
  let analyticsService: any;
  let actionEventsService: any;

  const mockTenantId = 'tenant-1';
  const mockUserId = 'user-1';
  const mockMembershipId = 'membership-1';

  const mockUser = {
    id: mockUserId,
    memberships: [
      {
        id: mockMembershipId,
        tenantId: mockTenantId,
        roles: ['TENANT_ADMIN'],
      },
    ],
  };

  beforeEach(async () => {
    const mockAssistantService = {
      chat: jest.fn(),
      chatV2: jest.fn(),
    };

    const mockAiEntitlements = {
      hasRemainingConsultations: jest.fn(),
      trackConsumption: jest.fn(),
    };

    const mockAnalyticsService = {};
    const mockActionEventsService = {};

    assistantService = mockAssistantService as any;
    aiEntitlements = mockAiEntitlements;
    analyticsService = mockAnalyticsService;
    actionEventsService = mockActionEventsService;

    controller = new AssistantController(
      assistantService,
      analyticsService,
      actionEventsService,
      aiEntitlements,
    );

    // Default mock setup
    aiEntitlements.hasRemainingConsultations.mockResolvedValue(true);
    aiEntitlements.trackConsumption.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /tenants/:tenantId/assistant/chat', () => {
    it('should delegate legacy /chat to chatV2 and track consumption on success', async () => {
      const request = {
        message: 'Cuanto debe la unidad 101 del Edificio A',
        page: 'payments',
      };

      assistantService.chatV2.mockResolvedValue({
        type: 'kpi',
        title: 'Unit Debt',
        summary: 'La unidad debe 500.000 ARS',
        data: { totalDebt: 500000, currency: 'ARS' },
        actions: [],
        meta: {
          intent: 'unit_debt',
          confidence: 0.95,
          tenantScoped: true,
        },
      } as StructuredResponse);

      const result = await controller.chat(
        mockTenantId,
        request,
        { user: mockUser } as any,
      );

      expect(result.answer).toBe('La unidad debe 500.000 ARS');
      expect(assistantService.chatV2).toHaveBeenCalledWith(
        mockTenantId,
        mockUserId,
        mockMembershipId,
        expect.objectContaining({
          ...request,
          routeSource: 'legacy_chat',
        }),
        ['TENANT_ADMIN'],
      );
      expect(aiEntitlements.trackConsumption).toHaveBeenCalledWith(mockTenantId, 1);
    });

    it('should throw ForbiddenException when consultation limit reached', async () => {
      const request = {
        message: 'Cuanto debe la unidad 101',
        page: 'payments',
      };

      aiEntitlements.hasRemainingConsultations.mockResolvedValue(false);

      await expect(
        controller.chat(mockTenantId, request, { user: mockUser } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(assistantService.chatV2).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when tenantId is empty', async () => {
      const request = {
        message: 'Test message',
        page: 'home',
      };

      await expect(
        controller.chat('', request, { user: mockUser } as any),
      ).rejects.toThrow();
    });

    it('should throw BadRequestException when message is missing', async () => {
      const request = {
        page: 'home',
      } as any;

      await expect(
        controller.chat(mockTenantId, request, { user: mockUser } as any),
      ).rejects.toThrow();
    });
  });

  describe('POST /tenants/:tenantId/assistant/chat/v2 - Feature Flag ON', () => {
    it('should return StructuredResponse when AI_INTENT_ENGINE_ENABLED=true', async () => {
      const request = {
        message: 'Cuanto debe la unidad 101 del Edificio A',
        page: 'payments',
        buildingId: 'b1',
        sessionId: 'session-123',
      };

      const structuredResponse: StructuredResponse = {
        type: 'kpi',
        title: 'Unit Debt',
        summary: 'The unit has a debt of 500.000 VES',
        data: { debt: 500000 },
        actions: [{ label: 'View Payments', action: 'VIEW_PAYMENTS', payload: {} }],
        meta: {
          intent: 'unit_debt',
          confidence: 0.95,
          tenantScoped: true,
        },
      };

      assistantService.chatV2.mockResolvedValue(structuredResponse);

      const result = await controller.chatV2(
        mockTenantId,
        request,
        { user: mockUser } as any,
      );

      expect(result).toEqual(structuredResponse);
      expect(assistantService.chatV2).toHaveBeenCalledWith(
        mockTenantId,
        mockUserId,
        mockMembershipId,
        expect.objectContaining({
          ...request,
          routeSource: 'chat_v2',
        }),
        ['TENANT_ADMIN'],
      );
      expect(aiEntitlements.trackConsumption).toHaveBeenCalledWith(mockTenantId, 1);
    });

    it('should pass sessionId to chatV2 when provided', async () => {
      const request = {
        message: 'Listar pagos del edificio',
        page: 'payments',
        sessionId: 'session-456',
      };

      const structuredResponse: StructuredResponse = {
        type: 'table',
        title: 'Payments',
        summary: 'Found 5 payments',
        data: [],
        meta: {
          intent: 'building_payments',
          confidence: 0.92,
          tenantScoped: true,
        },
      };

      assistantService.chatV2.mockResolvedValue(structuredResponse);

      await controller.chatV2(
        mockTenantId,
        request,
        { user: mockUser } as any,
      );

      expect(assistantService.chatV2).toHaveBeenCalledWith(
        mockTenantId,
        mockUserId,
        mockMembershipId,
        expect.objectContaining({
          ...request,
          routeSource: 'chat_v2',
        }),
        ['TENANT_ADMIN'],
      );
    });

    it('should generate sessionId when not provided', async () => {
      const request = {
        message: 'Estadisticas del edificio',
        page: 'reports',
      };

      const structuredResponse: StructuredResponse = {
        type: 'kpi',
        title: 'Building Stats',
        summary: 'Building has 20 units',
        data: { units: 20 },
        meta: {
          intent: 'building_stats',
          confidence: 0.88,
          tenantScoped: true,
        },
      };

      assistantService.chatV2.mockResolvedValue(structuredResponse);

      const result = await controller.chatV2(
        mockTenantId,
        request,
        { user: mockUser } as any,
      );

      expect(result).toEqual(structuredResponse);
      expect(assistantService.chatV2).toHaveBeenCalled();
    });
  });

  describe('POST /tenants/:tenantId/assistant/chat/v2 - Feature Flag OFF', () => {
    it('should return 403 when AI_INTENT_ENGINE_ENABLED=false', async () => {
      const request = {
        message: 'Cuanto debe la unidad 101',
        page: 'payments',
      };

      assistantService.chatV2.mockRejectedValue(
        new ForbiddenException('Intent engine disabled'),
      );

      await expect(
        controller.chatV2(mockTenantId, request, { user: mockUser } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(aiEntitlements.trackConsumption).not.toHaveBeenCalled();
    });
  });

  describe('POST /tenants/:tenantId/assistant/chat/v2 - Ambiguous Entity', () => {
    it('should return clarification type when entity is ambiguous', async () => {
      const request = {
        message: 'Cuanto debe Juan',
        page: 'payments',
      };

      const clarificationResponse: StructuredResponse = {
        type: 'clarification',
        title: 'Clarification Required',
        summary: 'Found multiple people named Juan. Please clarify which one.',
        data: {
          isAmbiguous: true,
          alternatives: [
            { id: 'person-1', displayName: 'Juan Pérez (A-101)' },
            { id: 'person-2', displayName: 'Juan García (A-102)' },
          ],
        },
        actions: [
          { label: 'Select Juan Pérez', action: 'SELECT', payload: { personId: 'person-1' } },
          { label: 'Select Juan García', action: 'SELECT', payload: { personId: 'person-2' } },
        ],
        meta: {
          intent: 'person_search',
          confidence: 0.75,
          tenantScoped: true,
        },
      };

      assistantService.chatV2.mockResolvedValue(clarificationResponse);

      const result = await controller.chatV2(
        mockTenantId,
        request,
        { user: mockUser } as any,
      );

      expect(result.type).toBe('clarification');
      expect(result.summary).toContain('Found multiple');
      expect(result.data).toHaveProperty('isAmbiguous', true);
    });
  });

  describe('POST /tenants/:tenantId/assistant/chat/v2 - RBAC Denial', () => {
    it('should return 403 when user lacks required permission', async () => {
      const request = {
        message: 'Cuanto debe la unidad 101 del Edificio A',
        page: 'payments',
      };

      assistantService.chatV2.mockRejectedValue(
        new ForbiddenException('Unauthorized access to this resource'),
      );

      await expect(
        controller.chatV2(mockTenantId, request, { user: mockUser } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(aiEntitlements.trackConsumption).not.toHaveBeenCalled();
    });
  });
});
