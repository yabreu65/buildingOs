/**
 * AI Router Service
 *
 * Classifies requests to determine if big model (expensive) is needed.
 * Uses small model (cheap) by default, scales to big model for complex tasks.
 *
 * Classification rules:
 * - Small model: General questions, simple navigation, basic info
 * - Big model: Analysis, complex reasoning, multi-step tasks, ANALYZE keyword
 */

import { Injectable } from '@nestjs/common';

export type ModelSize = 'SMALL' | 'BIG';

export interface RouterDecision {
  model: ModelSize;
  reason: string;
  complexity: 'LOW' | 'MEDIUM' | 'HIGH';
  estimatedTokens: number;
}

export interface RouterRequest {
  message: string;
  page: string;
  buildingId?: string;
  unitId?: string;
}

@Injectable()
export class AiRouterService {
  // Keywords that trigger big model
  private readonly bigModelKeywords = [
    'analyze', 'analysis', 'complex', 'explain', 'calculate',
    'forecast', 'predict', 'trend', 'optimization', 'recommendation',
    'summary', 'comprehensive', 'detailed', 'report', 'insight',
    'pattern', 'anomaly', 'root cause', 'investigation',
  ];

  // Pages that often need big model
  private readonly bigModelPages = [
    'payments', 'reports', 'analytics', 'finance',
  ];

  // Page count - messages on same page use small model
  private pageRequestCounts: Map<string, number> = new Map();

  constructor() {
    // Reset page counts every hour
    setInterval(() => this.pageRequestCounts.clear(), 3600000);
  }

  /**
   * Classify request and determine if big model is needed
   *
   * Strategy:
   * 1. Check keywords (high priority)
   * 2. Check page context (medium priority)
   * 3. Check message complexity heuristics (low priority)
   * 4. Check repeated questions (likely small model)
   *
   * @param request Router request with message and context
   * @returns RouterDecision with model selection and reasoning
   */
  classifyRequest(request: RouterRequest): RouterDecision {
    const lowerMessage = request.message.toLowerCase().trim();
    const wordCount = lowerMessage.split(/\s+/).length;
    const hasMultipleQuestions = (lowerMessage.match(/\?/g) || []).length > 1;

    // 1. Check for big model keywords
    for (const keyword of this.bigModelKeywords) {
      if (lowerMessage.includes(keyword)) {
        return {
          model: 'BIG',
          reason: `Request contains "${keyword}" - requires analysis`,
          complexity: 'HIGH',
          estimatedTokens: 400, // Bigger responses
        };
      }
    }

    // 2. Check page context
    const lowerPage = request.page.toLowerCase();
    if (this.bigModelPages.some(p => lowerPage.includes(p))) {
      // Financial/analytical pages often need big model
      return {
        model: 'BIG',
        reason: `Page "${request.page}" typically requires deeper analysis`,
        complexity: 'MEDIUM',
        estimatedTokens: 350,
      };
    }

    // 3. Check message complexity heuristics
    const pageKey = `${request.page}:${request.buildingId || 'global'}`;
    const requestCount = (this.pageRequestCounts.get(pageKey) || 0) + 1;
    this.pageRequestCounts.set(pageKey, requestCount);

    // Multiple questions or very long message → might need big model
    if (hasMultipleQuestions || wordCount > 80) {
      return {
        model: 'BIG',
        reason: `Complex request (${wordCount} words, ${hasMultipleQuestions ? 'multiple' : 'single'} question)`,
        complexity: 'MEDIUM',
        estimatedTokens: 350,
      };
    }

    // 4. Default: use small model
    return {
      model: 'SMALL',
      reason: 'Straightforward question - using cost-optimized model',
      complexity: 'LOW',
      estimatedTokens: 150, // Smaller, faster responses
    };
  }

  /**
   * Get model name based on router decision
   *
   * @param decision Router decision
   * @returns Model name (e.g., 'gpt-4.1-nano' for SMALL, 'gpt-4o-mini' for BIG)
   */
  getModelName(decision: ModelSize): string {
    switch (decision) {
      case 'SMALL':
        return process.env.AI_SMALL_MODEL || 'gpt-4.1-nano';
      case 'BIG':
        return process.env.AI_BIG_MODEL || 'gpt-4o-mini';
      default:
        return 'gpt-4.1-nano';
    }
  }

  /**
   * Get max tokens for response based on model size
   *
   * @param decision Router decision
   * @returns Max tokens for response
   */
  getMaxTokens(decision: ModelSize): number {
    switch (decision) {
      case 'SMALL':
        return parseInt(process.env.AI_MAX_TOKENS_SMALL || '150', 10);
      case 'BIG':
        return parseInt(process.env.AI_MAX_TOKENS_BIG || '400', 10);
      default:
        return 150;
    }
  }

  /**
   * Estimate cost savings per 1000 requests
   *
   * @returns Estimated monthly savings in cents
   */
  estimateSavings(): {
    smallModelCalls: number;
    bigModelCalls: number;
    estimatedMonthlyCents: number;
    savingsPct: number;
  } {
    // Assuming 70% small, 30% big model distribution
    const smallCalls = 700; // Out of 1000 monthly calls
    const bigCalls = 300;

    // Cost calculations (per 1M tokens):
    // Small (nano): input 10¢, output 40¢
    // Big (mini): input 15¢, output 60¢
    // Assume: 50 input + 150 output tokens per call average

    const smallInputCost = (smallCalls * 50 * 10) / 1_000_000;
    const smallOutputCost = (smallCalls * 150 * 40) / 1_000_000;
    const bigInputCost = (bigCalls * 50 * 15) / 1_000_000;
    const bigOutputCost = (bigCalls * 150 * 60) / 1_000_000;

    const totalCost = smallInputCost + smallOutputCost + bigInputCost + bigOutputCost;
    const allBigCost = ((smallCalls + bigCalls) * 50 * 15 + (smallCalls + bigCalls) * 150 * 60) / 1_000_000;

    const savingsCents = Math.round((allBigCost - totalCost) * 100);
    const savingsPct = Math.round(((allBigCost - totalCost) / allBigCost) * 100);

    return {
      smallModelCalls: smallCalls,
      bigModelCalls: bigCalls,
      estimatedMonthlyCents: Math.round(totalCost * 100),
      savingsPct,
    };
  }
}
