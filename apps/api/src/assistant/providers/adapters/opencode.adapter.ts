/**
 * OpenCode Adapter — implements AiProviderConfig with chat + healthCheck
 * Task 4.3: OpenCode provider for AI assistant
 */

import { Injectable, Logger } from '@nestjs/common';
import { AiProvider, AiProviderContext, ChatResponse, AiProviderStatus } from '../../ai.types';

@Injectable()
export class OpenCodeAdapter implements AiProvider {
  private readonly logger = new Logger(OpenCodeAdapter.name);
  private readonly timeout = 30000;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async chat(
    message: string,
    context: AiProviderContext,
    options?: { model?: string; maxTokens?: number },
  ): Promise<ChatResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const systemPrompt = this.buildSystemPrompt(context);
      const response = await fetch(`${this.baseUrl}/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          message,
          context: { page: context.page, buildingId: context.buildingId },
          model: options?.model,
          maxTokens: options?.maxTokens || 400,
          systemPrompt,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenCode API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as { response?: string; actions?: Array<{ type: string; payload?: Record<string, string> }> };
      return {
        answer: data.response || 'Unable to generate response',
        suggestedActions: (data.actions || []).map((a) => ({
          type: a.type as any,
          payload: a.payload || {},
        })),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async healthCheck(): Promise<AiProviderStatus> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${this.baseUrl}/v1/health`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        return { status: 'degraded', provider: 'opencode', latencyMs, error: `HTTP ${response.status}` };
      }

      return { status: 'healthy', provider: 'opencode', latencyMs };
    } catch (error) {
      return {
        status: 'unavailable',
        provider: 'opencode',
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildSystemPrompt(context: AiProviderContext): string {
    let prompt = 'You are a helpful property management AI assistant for BuildingOS.';
    if (context.page) prompt += `\nCurrent page: ${context.page}`;
    if (context.buildingId) prompt += `\nBuilding: ${context.buildingId}`;
    return prompt;
  }
}