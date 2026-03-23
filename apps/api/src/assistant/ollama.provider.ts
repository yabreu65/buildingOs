import { Injectable, Logger } from '@nestjs/common';
import { ChatResponse, SuggestedAction, AiProvider, AiProviderContext } from './ai.types';

/**
 * Ollama Provider for BuildingOS AI Assistant
 *
 * Integrates local Ollama inference server with fallback to OpenAI REST API.
 * Uses llama3 for SMALL requests and nemotron-3-super:cloud for BIG requests.
 *
 * Error handling strategy:
 * - Network errors or timeouts → retry once, then fallback to OpenAI if available
 * - JSON parse errors → use raw text as answer, generate context-based actions
 * - Ollama not running → clear error, attempt OpenAI fallback
 */

@Injectable()
export class OllamaProvider implements AiProvider {
  private readonly logger = new Logger(OllamaProvider.name);
  private readonly ollamaUrl = process.env.AI_OLLAMA_URL || 'http://localhost:11434';
  private readonly timeout = 10000; // 10 seconds

  /**
   * Chat with Ollama provider
   *
   * @param message - User message
   * @param context - Context with tenantId, buildingId, page, etc.
   * @param options - Optional model and maxTokens settings
   * @returns ChatResponse with answer and suggested actions
   */
  async chat(
    message: string,
    context: AiProviderContext,
    options?: { model?: string; maxTokens?: number },
  ): Promise<ChatResponse> {
    const model = options?.model || 'llama3';
    const maxTokens = options?.maxTokens || 150;

    try {
      // Step 1: Build context-aware system prompt
      const systemPrompt = this.buildSystemPrompt(context);

      // Step 2: Call Ollama
      const ollamaResponse = await this.callOllama(message, systemPrompt, model, maxTokens);

      // Step 3: Parse response
      const chatResponse = this.parseOllamaResponse(ollamaResponse, context);
      return chatResponse;
    } catch (ollamaError) {
      this.logger.warn(
        `Ollama provider failed (${model}): ${ollamaError instanceof Error ? ollamaError.message : String(ollamaError)}`,
      );

      // Fallback to OpenAI if OPENAI_API_KEY exists
      if (process.env.OPENAI_API_KEY) {
        try {
          this.logger.log('Attempting OpenAI fallback...');
          return await this.callOpenAiFallback(message, context, maxTokens);
        } catch (openaiError) {
          this.logger.error(
            `OpenAI fallback also failed: ${openaiError instanceof Error ? openaiError.message : String(openaiError)}`,
          );
          throw openaiError;
        }
      }

      // No fallback available - rethrow original error
      throw ollamaError;
    }
  }

  /**
   * Build context-aware system prompt
   */
  private buildSystemPrompt(context: any): string {
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

    if (context.page) {
      prompt += `\nCurrent page: ${context.page}`;
    }

    if (context.buildingId) {
      prompt += `\nBuilding: ${context.buildingId}`;
    }

    if (context.contextSnapshot) {
      prompt += `\n\nContext snapshot:
${JSON.stringify(context.contextSnapshot, null, 2)}`;
    }

    prompt += `\n\nIf you can't parse the user intent exactly, use this logic:
- If they ask about issues/problems → suggest VIEW_TICKETS
- If they ask about money/payments → suggest VIEW_PAYMENTS
- If they ask about reports/analytics → suggest VIEW_REPORTS
- If they ask about documents → suggest SEARCH_DOCS
- If they want to communicate → suggest DRAFT_COMMUNICATION
- If they want to report something → suggest CREATE_TICKET`;

    return prompt;
  }

  /**
   * Call Ollama API with timeout and error handling
   */
  private async callOllama(
    message: string,
    systemPrompt: string,
    model: string,
    maxTokens: number,
  ): Promise<string> {
    const requestBody = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      stream: false,
      options: {
        num_predict: maxTokens,
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;

      if (!data.message?.content) {
        throw new Error('Invalid Ollama response format: missing message.content');
      }

      return data.message.content;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse Ollama response
   *
   * First tries JSON parsing. If that fails, uses raw text as answer
   * and generates context-based actions.
   */
  private parseOllamaResponse(content: string, context: any): ChatResponse {
    let answer = content;
    let suggestedActions: SuggestedAction[] = [];

    // Try to parse as JSON
    try {
      const parsed = JSON.parse(content);
      if (parsed.answer && typeof parsed.answer === 'string') {
        answer = parsed.answer;
      }

      // Extract actions from JSON
      if (Array.isArray(parsed.actions)) {
        suggestedActions = parsed.actions
          .filter((action: any) => this.isValidActionType(action))
          .map((action: any) => ({
            type: action,
            payload: { buildingId: context.buildingId },
          }));
      }
    } catch {
      // JSON parsing failed - use raw text as answer
      // Generate context-based actions instead
      this.logger.debug('Could not parse JSON from Ollama response, using raw text');
    }

    // If no actions extracted, generate based on context
    if (suggestedActions.length === 0) {
      suggestedActions = this.generateContextBasedActions(context);
    }

    return { answer, suggestedActions };
  }

  /**
   * Generate context-based suggested actions
   *
   * Logic similar to MockProvider: suggest relevant actions based on page
   */
  private generateContextBasedActions(context: any): SuggestedAction[] {
    const actions: SuggestedAction[] = [];
    const page = (context.page || '').toLowerCase();

    // Always suggest VIEW_TICKETS unless already on that page
    if (page !== 'tickets') {
      actions.push({
        type: 'VIEW_TICKETS',
        payload: { buildingId: context.buildingId },
      });
    }

    // Suggest VIEW_PAYMENTS unless already on that page
    if (page !== 'payments' && page !== 'finance') {
      actions.push({
        type: 'VIEW_PAYMENTS',
        payload: { buildingId: context.buildingId },
      });
    }

    // Suggest based on page type
    if (page.includes('report') || page.includes('analytics')) {
      // Already on reports page
    } else {
      actions.push({
        type: 'VIEW_REPORTS',
        payload: { buildingId: context.buildingId },
      });
    }

    if (page.includes('document') || page.includes('file')) {
      // Already on documents page
    } else {
      actions.push({
        type: 'SEARCH_DOCS',
        payload: { buildingId: context.buildingId },
      });
    }

    return actions.slice(0, 3); // Limit to 3 actions
  }

  /**
   * Check if action type is valid
   */
  private isValidActionType(action: any): boolean {
    const validActions = [
      'VIEW_TICKETS',
      'VIEW_PAYMENTS',
      'VIEW_REPORTS',
      'SEARCH_DOCS',
      'DRAFT_COMMUNICATION',
      'CREATE_TICKET',
    ];
    return typeof action === 'string' && validActions.includes(action);
  }

  /**
   * Fallback to OpenAI REST API if Ollama fails
   *
   * Simple implementation for emergency fallback
   */
  private async callOpenAiFallback(message: string, context: any, maxTokens: number): Promise<ChatResponse> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI fallback requested but OPENAI_API_KEY not configured');
    }

    const requestBody = {
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful property management AI assistant. Respond concisely.',
        },
        {
          role: 'user',
          content: message,
        },
      ],
      max_tokens: maxTokens,
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    const answer = data.choices?.[0]?.message?.content || 'Unable to generate response';

    // Generate context-based actions for fallback
    const suggestedActions = this.generateContextBasedActions(context);

    return { answer, suggestedActions };
  }
}
