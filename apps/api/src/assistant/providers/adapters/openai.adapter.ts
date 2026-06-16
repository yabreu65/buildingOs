/**
 * OpenAI Adapter — implements AiProviderConfig with chat + healthCheck
 * Task 4.2: OpenAI provider for AI assistant
 */

import { Injectable, Logger } from '@nestjs/common';
import { AiProvider, AiProviderContext, ChatResponse, AiProviderStatus } from '../../ai.types';

@Injectable()
export class OpenAiAdapter implements AiProvider {
  private readonly logger = new Logger(OpenAiAdapter.name);
  private readonly baseUrl = 'https://api.openai.com/v1';
  private readonly timeout = 30000;

  constructor(
    private readonly apiKey: string,
    private readonly defaultModel: string = 'gpt-4o-mini',
  ) {}

  async chat(
    message: string,
    context: AiProviderContext,
    options?: { model?: string; maxTokens?: number },
  ): Promise<ChatResponse> {
    const model = options?.model || this.defaultModel;
    const maxTokens = options?.maxTokens || 400;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const systemPrompt = this.buildSystemPrompt(context);
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ],
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content || 'Unable to generate response';

      return this.parseResponse(content, context);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async healthCheck(): Promise<AiProviderStatus> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        return { status: 'unavailable', provider: 'openai', latencyMs, error: `HTTP ${response.status}` };
      }

      return { status: 'healthy', provider: 'openai', latencyMs };
    } catch (error) {
      return {
        status: 'unavailable',
        provider: 'openai',
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

  private parseResponse(content: string, context: AiProviderContext): ChatResponse {
    try {
      const parsed = JSON.parse(content);
      return {
        answer: parsed.answer || content,
        suggestedActions: parsed.actions || [],
      };
    } catch {
      return { answer: content, suggestedActions: [] };
    }
  }
}