import { Test, TestingModule } from '@nestjs/testing';
import { AiTicketCategoryService, TicketCategorySuggestion } from './ai-ticket-category.service';
import { AssistantService } from './assistant.service';

describe('AiTicketCategoryService', () => {
  let service: AiTicketCategoryService;
  let assistantService: AssistantService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiTicketCategoryService,
        {
          provide: AssistantService,
          useValue: {
            chat: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AiTicketCategoryService>(AiTicketCategoryService);
    assistantService = module.get<AssistantService>(AssistantService);
  });

  describe('suggestCategory', () => {
    it('should return null if AssistantService.chat throws', async () => {
      jest.spyOn(assistantService, 'chat').mockRejectedValueOnce(new Error('Network error'));

      const result = await service.suggestCategory(
        'tenant-123',
        'Broken pipe',
        'Water leaking from pipe in kitchen',
      );

      expect(result).toBeNull();
    });

    it('should parse a valid JSON response', async () => {
      const mockResponse = {
        answer: '{"category":"REPAIR","priority":"HIGH","confidence":85,"reasoning":"Broken pipe is a maintenance emergency"}',
        suggestedActions: [],
      };

      jest.spyOn(assistantService, 'chat').mockResolvedValueOnce(mockResponse);

      const result = await service.suggestCategory(
        'tenant-123',
        'Broken pipe',
        'Water leaking from pipe in kitchen',
      );

      expect(result).not.toBeNull();
      expect(result?.category).toBe('REPAIR');
      expect(result?.priority).toBe('HIGH');
      expect(result?.confidence).toBe(85);
      expect(result?.reasoning).toContain('pipe');
    });

    it('should handle markdown-wrapped JSON', async () => {
      const mockResponse = {
        answer: '```json\n{"category":"MAINTENANCE","priority":"LOW","confidence":70,"reasoning":"Routine painting work"}\n```',
        suggestedActions: [],
      };

      jest.spyOn(assistantService, 'chat').mockResolvedValueOnce(mockResponse);

      const result = await service.suggestCategory(
        'tenant-123',
        'Paint wall',
        'Building wall needs repainting',
      );

      expect(result?.category).toBe('MAINTENANCE');
      expect(result?.priority).toBe('LOW');
    });

    it('should fallback to OTHER if invalid category', async () => {
      const mockResponse = {
        answer: '{"category":"INVALID_CATEGORY","priority":"MEDIUM","confidence":50,"reasoning":"Unknown"}',
        suggestedActions: [],
      };

      jest.spyOn(assistantService, 'chat').mockResolvedValueOnce(mockResponse);

      const result = await service.suggestCategory(
        'tenant-123',
        'Some ticket',
        'Some description',
      );

      expect(result?.category).toBe('OTHER');
    });

    it('should fallback to MEDIUM if invalid priority', async () => {
      const mockResponse = {
        answer: '{"category":"REPAIR","priority":"CRITICAL","confidence":50,"reasoning":"Unknown"}',
        suggestedActions: [],
      };

      jest.spyOn(assistantService, 'chat').mockResolvedValueOnce(mockResponse);

      const result = await service.suggestCategory(
        'tenant-123',
        'Some ticket',
        'Some description',
      );

      expect(result?.priority).toBe('MEDIUM');
    });

    it('should clamp confidence between 0-100', async () => {
      const mockResponse = {
        answer: '{"category":"REPAIR","priority":"HIGH","confidence":150,"reasoning":"Test"}',
        suggestedActions: [],
      };

      jest.spyOn(assistantService, 'chat').mockResolvedValueOnce(mockResponse);

      const result = await service.suggestCategory(
        'tenant-123',
        'Test',
        'Test description',
      );

      expect(result?.confidence).toBe(100);
    });

    it('should pass buildingId and unitId to AssistantService', async () => {
      const mockResponse = {
        answer: '{"category":"CLEANING","priority":"MEDIUM","confidence":75,"reasoning":"Common area cleaning"}',
        suggestedActions: [],
      };

      jest.spyOn(assistantService, 'chat').mockResolvedValueOnce(mockResponse);

      await service.suggestCategory(
        'tenant-123',
        'Clean lobby',
        'Lobby needs vacuuming',
        'building-456',
        'unit-789',
      );

      expect(assistantService.chat).toHaveBeenCalledWith(
        'tenant-123',
        'system',
        'system',
        expect.objectContaining({
          buildingId: 'building-456',
          unitId: 'unit-789',
          page: 'internal:ticket-categorization',
        }),
        ['SUPER_ADMIN'],
      );
    });

    it('should return null if JSON parsing fails', async () => {
      const mockResponse = {
        answer: 'This is not JSON at all',
        suggestedActions: [],
      };

      jest.spyOn(assistantService, 'chat').mockResolvedValueOnce(mockResponse);

      const result = await service.suggestCategory(
        'tenant-123',
        'Test',
        'Test description',
      );

      expect(result).toBeNull();
    });

    it('should handle all valid categories', async () => {
      const categories = ['MAINTENANCE', 'REPAIR', 'CLEANING', 'COMPLAINT', 'SAFETY', 'BILLING', 'OTHER'];

      for (const category of categories) {
        const mockResponse = {
          answer: `{"category":"${category}","priority":"MEDIUM","confidence":80,"reasoning":"Test"}`,
          suggestedActions: [],
        };

        jest.spyOn(assistantService, 'chat').mockResolvedValueOnce(mockResponse);

        const result = await service.suggestCategory(
          'tenant-123',
          'Test',
          'Test description',
        );

        expect(result?.category).toBe(category);
      }
    });
  });
});
