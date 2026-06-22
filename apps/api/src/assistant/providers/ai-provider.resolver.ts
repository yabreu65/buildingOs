/**
 * AI Provider Resolver — reads AI_PROVIDER from environment.
 * Safe: defaults to 'none', validates required credentials, never logs secrets.
 */

import { AiProviderOptions } from './ai-provider.module';

export function resolveAiProvider(env: NodeJS.ProcessEnv = process.env): AiProviderOptions {
  const provider = (env.AI_PROVIDER || 'none') as AiProviderOptions['provider'];
  const options: AiProviderOptions = { provider };

  if (provider === 'none') {
    return options;
  }

  if (provider === 'openai') {
    if (!env.OPENAI_API_KEY) {
      throw new Error(
        'OPENAI_API_KEY is required when AI_PROVIDER=openai. ' +
        'Set the env var or switch to AI_PROVIDER=none.',
      );
    }
    options.openaiApiKey = env.OPENAI_API_KEY;
    options.openaiModel = env.AI_OPENAI_MODEL || undefined;
    return options;
  }

  if (provider === 'opencode') {
    options.opencodeApiKey = env.OPENCODE_API_KEY;
    options.opencodeUrl = env.OPENCODE_URL;
    return options;
  }

  if (provider === 'ollama') {
    if (!env.AI_OLLAMA_URL) {
      throw new Error(
        'AI_OLLAMA_URL is required when AI_PROVIDER=ollama. ' +
        'Set the env var or switch to AI_PROVIDER=none.',
      );
    }
    options.ollamaUrl = env.AI_OLLAMA_URL;
    return options;
  }

  if (provider === 'gemini') {
    if (!env.GEMINI_API_KEY) {
      throw new Error(
        'GEMINI_API_KEY is required when AI_PROVIDER=gemini. ' +
        'Set the env var or switch to AI_PROVIDER=none.',
      );
    }
    options.geminiApiKey = env.GEMINI_API_KEY;
    options.geminiModel = env.GEMINI_MODEL || env.AI_GEMINI_MODEL || undefined;
    return options;
  }

  return options;
}
