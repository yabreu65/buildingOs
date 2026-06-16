/**
 * Ollama Adapter — implements AiProvider with chat + healthCheck
 * Task 4.4: Refactored from ollama.provider.ts, no hardcoded localhost default
 */

import { Injectable, Logger } from '@nestjs/common';
import { AiProvider, AiProviderContext, ChatResponse, AiProviderStatus, SuggestedAction, SuggestedActionType } from '../../ai.types';

type OllamaChatApiResponse = {
  message?: {
    content?: string;
  };
};

type ParsedOllamaResponse = {
  answer?: unknown;
  actions?: unknown;
};

@Injectable()
export class OllamaAdapter implements AiProvider {
  private readonly logger = new Logger(OllamaAdapter.name);
  private readonly ollamaUrl: string;
  private readonly timeout = 10000;

  constructor(ollamaUrl: string) {
    if (!ollamaUrl) {
      throw new Error('AI_OLLAMA_URL is required when AI_PROVIDER=ollama. No hardcoded default URL is permitted.');
    }
    this.ollamaUrl = ollamaUrl;
  }

  async chat(
    message: string,
    context: AiProviderContext,
    options?: { model?: string; maxTokens?: number },
  ): Promise<ChatResponse> {
    const model = options?.model || 'llama3';
    const maxTokens = options?.maxTokens || 150;

    const systemPrompt = this.buildSystemPrompt(context);
    const ollamaResponse = await this.callOllama(message, systemPrompt, model, maxTokens);
    return this.parseOllamaResponse(ollamaResponse, context);
  }

  async healthCheck(): Promise<AiProviderStatus> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        return {
          status: 'unavailable',
          provider: 'ollama',
          latencyMs,
          error: `Ollama returned HTTP ${response.status}`,
        };
      }

      const body = (await response.json()) as { models?: Array<{ name?: string }> };
      const modelsAvailable = Array.isArray(body.models)
        ? body.models.map((m) => m?.name).filter((name): name is string => Boolean(name))
        : [];

      return {
        status: latencyMs > 3000 ? 'degraded' : 'healthy',
        provider: 'ollama',
        latencyMs,
        modelsAvailable,
      };
    } catch (error) {
      return {
        status: 'unavailable',
        provider: 'ollama',
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildSystemPrompt(context: AiProviderContext): string {
    let prompt = `You are a helpful property management AI assistant for BuildingOS.
You provide concise, actionable responses.
Respond in JSON format with: { "answer": "...", "actions": ["ACTION_NAME", ...] }

Available actions:
- VIEW_TICKETS: Show ticket management interface
- VIEW_PAYMENTS: Show payment/finance dashboard
- VIEW_REPORTS: Show analytics/reports
- SEARCH_DOCS: Search document library
- DRAFT_COMMUNICATION: Draft a communication to residents
- CREATE_TICKET: Create a new maintenance ticket
`;

    if (context.page) prompt += `\nCurrent page: ${context.page}`;
    if (context.buildingId) prompt += `\nBuilding: ${context.buildingId}`;
    if (context.contextSnapshot) prompt += `\n\nContext snapshot:\n${JSON.stringify(context.contextSnapshot, null, 2)}`;

    return prompt;
  }

  private async callOllama(message: string, systemPrompt: string, model: string, maxTokens: number): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ],
          stream: false,
          options: { num_predict: maxTokens },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as OllamaChatApiResponse;
      if (!data.message?.content) {
        throw new Error('Invalid Ollama response format: missing message.content');
      }

      return data.message.content;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseOllamaResponse(content: string, context: AiProviderContext): ChatResponse {
    let answer = content;
    let suggestedActions: SuggestedAction[] = [];

    try {
      const parsed = JSON.parse(content) as ParsedOllamaResponse;
      if (parsed.answer && typeof parsed.answer === 'string') {
        answer = parsed.answer;
      }
      if (Array.isArray(parsed.actions)) {
        suggestedActions = parsed.actions
          .filter((action): action is SuggestedActionType => this.isValidActionType(action))
          .map((action) => ({ type: action, payload: { buildingId: context.buildingId } }));
      }
    } catch {
      this.logger.debug('Could not parse JSON from Ollama response, using raw text');
    }

    if (suggestedActions.length === 0) {
      suggestedActions = this.generateContextBasedActions(context);
    }

    return { answer, suggestedActions };
  }

  private isValidActionType(action: unknown): action is SuggestedActionType {
    const validActions: SuggestedActionType[] = [
      'VIEW_TICKETS', 'VIEW_PAYMENTS', 'VIEW_REPORTS', 'SEARCH_DOCS', 'DRAFT_COMMUNICATION', 'CREATE_TICKET',
    ];
    return typeof action === 'string' && validActions.includes(action as SuggestedActionType);
  }

  private generateContextBasedActions(context: AiProviderContext): SuggestedAction[] {
    const actions: SuggestedAction[] = [];
    const page = (context.page || '').toLowerCase();

    if (page !== 'tickets') actions.push({ type: 'VIEW_TICKETS', payload: { buildingId: context.buildingId } });
    if (page !== 'payments' && page !== 'finance') actions.push({ type: 'VIEW_PAYMENTS', payload: { buildingId: context.buildingId } });
    if (!page.includes('report') && !page.includes('analytics')) actions.push({ type: 'VIEW_REPORTS', payload: { buildingId: context.buildingId } });

    return actions.slice(0, 3);
  }
}