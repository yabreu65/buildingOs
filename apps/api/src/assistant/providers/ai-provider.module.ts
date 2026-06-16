/**
 * AI Provider Module — DynamicModule for AI provider selection with circuit breaker
 * Task 4.6: Wraps adapter in circuit breaker, selects provider from AI_PROVIDER env var
 * 
 * Production fix: When provider=none, exports a NoOp provider without CircuitBreaker
 * to avoid DI injection issues with non-injectable constructor parameters.
 */

import { DynamicModule, Module, Provider } from '@nestjs/common';
import { AiProvider } from '../ai.types';
import { OllamaAdapter } from './adapters/ollama.adapter';
import { OpenAiAdapter } from './adapters/openai.adapter';
import { OpenCodeAdapter } from './adapters/opencode.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { CircuitBreaker } from './circuit-breaker';
import { AssistantLlmHealthService } from '../llm-health.service';
import { AssistantLlmHealthController } from '../llm-health.controller';

export const AI_PROVIDER_TOKEN = 'AI_PROVIDER';

export interface AiProviderOptions {
  provider: 'none' | 'openai' | 'opencode' | 'ollama' | 'gemini';
  ollamaUrl?: string;
  openaiApiKey?: string;
  opencodeApiKey?: string;
  opencodeUrl?: string;
  openaiModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
}

@Module({})
export class AiProviderModule {
  static register(options: AiProviderOptions): DynamicModule {
    if (options.provider === 'none') {
      return {
        module: AiProviderModule,
        providers: [
          {
            provide: AI_PROVIDER_TOKEN,
            useValue: null,
          },
          AssistantLlmHealthService,
        ],
        controllers: [AssistantLlmHealthController],
        exports: [AI_PROVIDER_TOKEN, AssistantLlmHealthService],
      };
    }

    const aiProviderFactory: Provider = {
      provide: AI_PROVIDER_TOKEN,
      useFactory: () => {
        switch (options.provider) {
          case 'openai':
            return new OpenAiAdapter(options.openaiApiKey || '', options.openaiModel);
          case 'opencode':
            return new OpenCodeAdapter(options.opencodeApiKey || '', options.opencodeUrl || '');
          case 'ollama':
            if (!options.ollamaUrl) {
              throw new Error('AI_OLLAMA_URL is required when AI_PROVIDER=ollama');
            }
            return new OllamaAdapter(options.ollamaUrl);
          case 'gemini':
            if (!options.geminiApiKey) {
              throw new Error('GEMINI_API_KEY is required when AI_PROVIDER=gemini');
            }
            return new GeminiAdapter(options.geminiApiKey, options.geminiModel);
          default:
            return null;
        }
      },
    };

    return {
      module: AiProviderModule,
      providers: [
        aiProviderFactory,
        CircuitBreaker,
        AssistantLlmHealthService,
      ],
      controllers: [AssistantLlmHealthController],
      exports: [AI_PROVIDER_TOKEN, CircuitBreaker, AssistantLlmHealthService],
    };
  }
}