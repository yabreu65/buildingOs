/**
 * AI Pricing Calculator
 *
 * Calculates token costs based on model and token usage.
 * Supports OpenAI models with pricing per million tokens.
 */

/**
 * Pricing table for models (per 1M tokens in cents)
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4.1-nano': {
    input: 10, // $0.10 per 1M input tokens
    output: 40, // $0.40 per 1M output tokens
  },
  'gpt-4o-mini': {
    input: 15, // $0.15 per 1M input tokens
    output: 60, // $0.60 per 1M output tokens
  },
  // Add more models as needed
};

export interface TokenCost {
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}

/**
 * Calculate cost in cents for given tokens and model
 *
 * @param model Model name (e.g., 'gpt-4o-mini')
 * @param inputTokens Number of input tokens
 * @param outputTokens Number of output tokens
 * @returns Cost in cents (rounded)
 */
export function calculateTokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): TokenCost {
  const pricing = MODEL_PRICING[model];

  if (!pricing) {
    // Unknown model, estimate based on gpt-4o-mini
    const defaultPricing = MODEL_PRICING['gpt-4o-mini'];
    const costUsd =
      (inputTokens * defaultPricing.input + outputTokens * defaultPricing.output) /
      1_000_000;
    const costCents = Math.round(costUsd * 100);

    return {
      inputTokens,
      outputTokens,
      costCents,
    };
  }

  // Calculate cost in dollars first, then convert to cents
  const costUsd =
    (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  const costCents = Math.round(costUsd * 100);

  return {
    inputTokens,
    outputTokens,
    costCents,
  };
}

/**
 * Get current month in "YYYY-MM" format
 */
export function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Get percentage of budget used
 */
export function getPercentUsed(usedCents: number, budgetCents: number): number {
  if (budgetCents <= 0) return 100;
  return Math.round((usedCents / budgetCents) * 100);
}

/**
 * Check if usage crossed warning threshold (80% by default)
 */
export function isWarningThreshold(
  usedCents: number,
  budgetCents: number,
  threshold: number = 0.8,
): boolean {
  return usedCents >= budgetCents * threshold;
}

/**
 * Check if budget exceeded
 */
export function isBudgetExceeded(usedCents: number, budgetCents: number): boolean {
  return usedCents >= budgetCents;
}

/**
 * Example pricing table
 * Model: gpt-4o-mini (cheap)
 * - 1000 input tokens + 500 output tokens = ~$0.0225 = 2.25 cents
 * - 10k input + 5k output = ~$0.225 = 22.5 cents
 * - 100k input + 50k output = ~$2.25 = 225 cents = $2.25
 *
 * Budget examples:
 * - $5/month (500 cents) = 2,222 conversations at 10k+5k tokens average
 * - $50/month (5000 cents) = 22,222 conversations
 */

/**
 * Estimate tokens per message (rough approximation)
 * Typical conversation:
 * - User message: 30 tokens (short question)
 * - AI response: 100-200 tokens (answer)
 * Total: ~150-200 tokens per exchange
 *
 * With rate limiting at 100 calls/day and 500 token responses:
 * - 100 calls × 200 tokens average = 20,000 tokens/day
 * - Monthly: 600,000 tokens ≈ $13.50 at gpt-4o-mini rates
 * - Therefore: $5/month budget supports ~50-100 calls/month for typical usage
 */
