/**
 * Gemini Adapter — implements AiProvider with chat + healthCheck
 * Uses Google Gemini API (generativelanguage.googleapis.com)
 */

import { Injectable, Logger } from '@nestjs/common';
import { AiProvider, AiProviderContext, ChatResponse, AiProviderStatus } from '../../ai.types';

@Injectable()
export class GeminiAdapter implements AiProvider {
  private readonly logger = new Logger(GeminiAdapter.name);
  private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  private readonly timeout = 30000;

  constructor(
    private readonly apiKey: string,
    private readonly defaultModel: string = 'gemini-2.0-flash',
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
      const response = await fetch(
        `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemPrompt }],
            },
            contents: [
              {
                parts: [{ text: message }],
              },
            ],
            generationConfig: {
              maxOutputTokens: maxTokens,
            },
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Unable to generate response';

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
      const response = await fetch(
        `${this.baseUrl}/models?key=${this.apiKey}`,
        {
          method: 'GET',
          signal: controller.signal,
        },
      );

      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        return { status: 'unavailable', provider: 'gemini', latencyMs, error: `HTTP ${response.status}` };
      }

      return { status: 'healthy', provider: 'gemini', latencyMs };
    } catch (error) {
      return {
        status: 'unavailable',
        provider: 'gemini',
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
