/**
 * Tests for AI types updates
 * Task 1.5: Verify AiProvider healthCheck and AiProviderStatus type
 */

import { AiProvider, AiProviderStatus, ChatResponse, AiProviderContext } from './ai.types';

describe('AI Types', () => {
  describe('AiProvider', () => {
    it('requires healthCheck method on implementing classes', () => {
      const mockProvider: AiProvider = {
        chat: jest.fn(),
        healthCheck: jest.fn(),
      };

      expect(mockProvider.chat).toBeDefined();
      expect(mockProvider.healthCheck).toBeDefined();
    });

    it('healthCheck returns AiProviderStatus', async () => {
      const healthyStatus: AiProviderStatus = {
        status: 'healthy',
        provider: 'ollama',
        latencyMs: 42,
      };

      expect(healthyStatus.status).toBe('healthy');
      expect(healthyStatus.provider).toBe('ollama');
      expect(healthyStatus.latencyMs).toBe(42);
    });
  });

  describe('AiProviderStatus', () => {
    it('supports healthy status', () => {
      const status: AiProviderStatus = { status: 'healthy', provider: 'openai' };
      expect(status.status).toBe('healthy');
    });

    it('supports degraded status', () => {
      const status: AiProviderStatus = { status: 'degraded', provider: 'ollama', latencyMs: 5000 };
      expect(status.status).toBe('degraded');
    });

    it('supports unavailable status', () => {
      const status: AiProviderStatus = { status: 'unavailable', provider: 'ollama', error: 'Connection refused' };
      expect(status.status).toBe('unavailable');
    });

    it('supports disabled status', () => {
      const status: AiProviderStatus = { status: 'disabled', provider: 'none' };
      expect(status.status).toBe('disabled');
    });
  });
});