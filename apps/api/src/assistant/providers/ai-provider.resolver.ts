/**
 * AI Provider Resolver — reads AI_PROVIDER from environment.
 * Safe: defaults to 'none', validates required credentials, never logs secrets.
 */

import { AiProviderOptions } from './ai-provider.module';

export interface AiConsensusModeConfig {
  provider: 'none' | 'hybrid' | 'openai' | 'opencode' | 'ollama' | 'gemini';
  localProvider: 'ollama';
  alwaysCallLocalModel: boolean;
  consensusMode: boolean;
  geminiFallbackEnabled: boolean;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
}

function parseBooleanEnv(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === null || value.trim() === '') {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

export function resolveAiConsensusModeConfig(env: NodeJS.ProcessEnv = process.env): AiConsensusModeConfig {
  const provider = ((env.AI_PROVIDER || 'none').trim() || 'none') as AiConsensusModeConfig['provider'];

  return {
    provider,
    localProvider: 'ollama',
    alwaysCallLocalModel: parseBooleanEnv(env.AI_ALWAYS_CALL_LOCAL_MODEL, false),
    consensusMode: parseBooleanEnv(env.AI_CONSENSUS_MODE, false),
    geminiFallbackEnabled: parseBooleanEnv(env.AI_GEMINI_FALLBACK_ENABLED, true),
    ollamaBaseUrl: env.OLLAMA_BASE_URL || env.AI_OLLAMA_URL || undefined,
    ollamaModel: env.OLLAMA_MODEL || env.AI_OLLAMA_MODEL || undefined,
  };
}

export function resolveAiProvider(env: NodeJS.ProcessEnv = process.env): AiProviderOptions {
  const rawProvider = (env.AI_PROVIDER || 'none').trim() || 'none';
  const provider = (rawProvider === 'hybrid' ? 'ollama' : rawProvider) as AiProviderOptions['provider'];
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
    const ollamaUrl = env.OLLAMA_BASE_URL || env.AI_OLLAMA_URL;
    if (!ollamaUrl) {
      throw new Error(
        'AI_OLLAMA_URL is required when AI_PROVIDER=ollama. ' +
        'AI_OLLAMA_URL (or OLLAMA_BASE_URL) is required when AI_PROVIDER=ollama or AI_PROVIDER=hybrid. ' +
        'Set the env var or switch to AI_PROVIDER=none.',
      );
    }
    options.ollamaUrl = ollamaUrl;
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
