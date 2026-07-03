export function isLocalDevelopmentEnv(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv === 'development' || nodeEnv === 'test';
}

export function resolveDevOnlyFallback(
  value: string | undefined,
  fallback: string,
  envName: string,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  const normalized = value?.trim();
  if (normalized) {
    return normalized;
  }

  if (isLocalDevelopmentEnv(nodeEnv)) {
    return fallback;
  }

  throw new Error(`${envName} is required outside development`);
}

export function resolveAssistantProviderMode(
  rawProvider: string | undefined = process.env.AI_PROVIDER,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): 'MOCK' | 'OLLAMA' | 'NONE' {
  const provider = rawProvider?.trim().toUpperCase();

  if (!provider) {
    if (isLocalDevelopmentEnv(nodeEnv)) {
      return 'MOCK';
    }

    throw new Error('AI_PROVIDER is required outside development. Use AI_PROVIDER=none to disable the assistant or AI_PROVIDER=ollama for local inference.');
  }

  if (provider === 'NONE') {
    return 'NONE';
  }

  if (provider === 'MOCK') {
    if (isLocalDevelopmentEnv(nodeEnv)) {
      return 'MOCK';
    }

    throw new Error('AI_PROVIDER=MOCK is only allowed in development');
  }

  if (provider === 'HYBRID' || provider === 'OLLAMA') {
    return 'OLLAMA';
  }

  throw new Error(`AI_PROVIDER=${provider} is not supported by AssistantService`);
}
