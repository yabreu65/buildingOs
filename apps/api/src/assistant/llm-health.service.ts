import { Injectable, Logger } from '@nestjs/common';

export interface LlmHealthResponse {
  enabled: boolean;
  provider: 'ollama' | 'none';
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

  getProviderConfig(): { enabled: boolean; baseUrl: string; model: string } {
    const enabled = process.env.AI_INTENT_ENGINE_ENABLED !== 'false';
    const baseUrl = process.env.AI_OLLAMA_URL || 'http://localhost:11434';
    const model = process.env.AI_OLLAMA_MODEL || 'llama3:latest';
    return { enabled, baseUrl, model };
  }

  async getHealth(): Promise<LlmHealthResponse> {
    const config = this.getProviderConfig();
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
