import { Injectable, Logger } from '@nestjs/common';

export interface ClassifierResult {
  category: 'DEBT' | 'TICKETS' | 'DOCUMENTS' | 'PAYMENTS' | 'RESIDENTS' | 'STATS' | 'GENERAL';
  confidence: number;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

interface ClassifierResponsePayload {
  category?: string;
  confidence?: number;
}

/**
 * AI Classifier Service
 *
 * Uses local Ollama to classify ambiguous user queries into known categories.
 * This enables retrying strict queries with expanded synonyms when keywords fail.
 *
 * Model: llama3 (fast, local, free)
 * Max tokens: 50 (short JSON response)
 * Temperature: 0.1 (deterministic)
 */
@Injectable()
export class AiClassifierService {
  private readonly logger = new Logger(AiClassifierService.name);
  private readonly ollamaUrl = process.env.AI_OLLAMA_URL || 'http://localhost:11434';
  private readonly timeout = 5000; // 5 seconds - classifier should be fast
  private readonly model = process.env.AI_CLASSIFIER_MODEL || process.env.AI_OLLAMA_MODEL || 'llama3:latest';

  /**
   * Classify a user message into a known category
   *
   * @param message - User message to classify
   * @returns ClassifierResult with category and confidence (0-1)
   */
  async classify(message: string): Promise<ClassifierResult> {
    const systemPrompt = `Sos un clasificador de intenciones para un asistente de administracion de edificios.
Clasifica la pregunta del usuario en UNA de estas categorias:
- DEBT: preguntas sobre deudas, saldos, expensas, pagos pendientes, cuanto debe, esta al dia
- TICKETS: preguntas sobre problemas, reclamos, averias, incidentes, fallas, solicitudes
- DOCUMENTS: preguntas sobre archivos, actas, reglamentos, planos, comprobantes, PDFs
- PAYMENTS: preguntas sobre pagos recibidos, transferencias, cobros, recibos, movimientos
- RESIDENTS: preguntas sobre quien vive, propietarios, ocupantes, inquilinos, habitantes
- STATS: preguntas sobre estadisticas, resumen, estado general, cuantas unidades, como viene
- GENERAL: saludos, despedidas, preguntas no relacionadas al edificio, conversacion casual

Responde SOLO con JSON valido sin markdown:
{"category":"DEBT|TICKETS|DOCUMENTS|PAYMENTS|RESIDENTS|STATS|GENERAL","confidence":0.0-1.0}`;

    try {
      const response = await this.callOllama(message, systemPrompt);
      return this.parseResponse(response);
    } catch (error) {
      this.logger.warn(`Classifier failed: ${error instanceof Error ? error.message : String(error)}`);
      // Return GENERAL with 0 confidence so it falls through to normal LLM
      return { category: 'GENERAL', confidence: 0 };
    }
  }

  /**
   * Check if Ollama is available
   */
  async isHealthy(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(`${this.ollamaUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async callOllama(message: string, systemPrompt: string): Promise<string> {
    const requestBody = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      stream: false,
      options: {
        num_predict: 50,
        temperature: 0.1,
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const raw: unknown = await response.json();
      const data = raw as OllamaChatResponse;

      if (!data.message?.content) {
        throw new Error('Invalid Ollama response format: missing message.content');
      }

      return data.message.content;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseResponse(content: string): ClassifierResult {
    // Try to extract JSON from the response (might be wrapped in markdown)
    let jsonStr = content.trim();

    // Remove markdown code blocks if present
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      jsonStr = codeBlockMatch[1];
    }

    try {
      const parsed: unknown = JSON.parse(jsonStr);
      const response = parsed as ClassifierResponsePayload;

      const validCategories = ['DEBT', 'TICKETS', 'DOCUMENTS', 'PAYMENTS', 'RESIDENTS', 'STATS', 'GENERAL'];
      const category = response.category?.toUpperCase();
      const confidence = typeof response.confidence === 'number' ? response.confidence : 0;

      if (!category || !validCategories.includes(category)) {
        this.logger.warn(`Invalid category from classifier: ${response.category}`);
        return { category: 'GENERAL', confidence: 0 };
      }

      return {
        category: category as ClassifierResult['category'],
        confidence: Math.max(0, Math.min(1, confidence)),
      };
    } catch (error) {
      this.logger.warn(`Failed to parse classifier response: ${content}`);
      return { category: 'GENERAL', confidence: 0 };
    }
  }
}
