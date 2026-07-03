import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { AiProvider, AiProviderStatus } from './ai.types';
import { AI_PROVIDER_TOKEN } from './providers/ai-provider.module';
import { isLocalDevelopmentEnv } from './assistant-env';

export interface LlmHealthResponse {
  enabled: boolean;
  provider: 'ollama' | 'openai' | 'opencode' | 'none';
  baseUrl: string;
  model: string;
  reachable: boolean;
  latencyMs: number | null;
  modelsAvailable: string[];
}

@Injectable()
export class AssistantLlmHealthService {
  private readonly logger = new Logger(AssistantLlmHealthService.name);
  private readonly timeoutMs = 3000;

  constructor(
    @Optional() @Inject(AI_PROVIDER_TOKEN) private readonly aiProvider: AiProvider | null,
  ) {}

  getProviderConfig(): { enabled: boolean; baseUrl: string; model: string } {
    const enabled = process.env.AI_INTENT_ENGINE_ENABLED !== 'false';
    const baseUrl = process.env.AI_OLLAMA_URL || '';
    const model = isLocalDevelopmentEnv() ? (process.env.AI_OLLAMA_MODEL || 'llama3:latest') : (process.env.AI_OLLAMA_MODEL || '');
    return { enabled, baseUrl, model };
  }

  async getHealth(): Promise<LlmHealthResponse> {
    const config = this.getProviderConfig();

    // If we have a real AI provider, use its healthCheck
    if (this.aiProvider && typeof this.aiProvider.healthCheck === 'function') {
      try {
        const status = await this.aiProvider.healthCheck();
        return {
          enabled: config.enabled,
          provider: this.mapProviderName(),
          baseUrl: config.baseUrl,
          model: config.model,
          reachable: status.status === 'healthy',
          latencyMs: status.latencyMs ?? null,
          modelsAvailable: status.modelsAvailable ?? [],
        };
      } catch (error) {
        return {
          enabled: config.enabled,
          provider: this.mapProviderName(),
          baseUrl: config.baseUrl,
          model: config.model,
          reachable: false,
          latencyMs: null,
          modelsAvailable: [],
        };
      }
    }

    // Fallback: legacy Ollama health check for backward compatibility
    return this.legacyOllamaHealthCheck(config);
  }

  private mapProviderName(): 'ollama' | 'openai' | 'opencode' | 'none' {
    const provider = process.env.AI_PROVIDER || 'none';
    switch (provider) {
      case 'openai': return 'openai';
      case 'opencode': return 'opencode';
      case 'ollama': return 'ollama';
      default: return 'none';
    }
  }

  private async legacyOllamaHealthCheck(config: { enabled: boolean; baseUrl: string; model: string }): Promise<LlmHealthResponse> {
    if (!config.baseUrl) {
      return {
        enabled: false,
        provider: 'none',
        baseUrl: '',
        model: config.model,
        reachable: false,
        latencyMs: null,
        modelsAvailable: [],
      };
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${config.baseUrl}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        return {
          enabled: config.enabled,
          provider: 'ollama',
          baseUrl: config.baseUrl,
          model: config.model,
          reachable: false,
          latencyMs,
          modelsAvailable: [],
        };
      }

      const body = (await response.json()) as { models?: Array<{ name?: string }> };
      const modelsAvailable = Array.isArray(body.models)
        ? body.models.map((item) => item?.name).filter((name): name is string => Boolean(name))
        : [];

      return {
        enabled: config.enabled,
        provider: 'ollama',
        baseUrl: config.baseUrl,
        model: config.model,
        reachable: true,
        latencyMs,
        modelsAvailable,
      };
    } catch (error) {
      this.logger.warn(`LLM health check failed: ${error instanceof Error ? error.message : String(error)}`);
      return {
        enabled: config.enabled,
        provider: 'ollama',
        baseUrl: config.baseUrl,
        model: config.model,
        reachable: false,
        latencyMs: null,
        modelsAvailable: [],
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
