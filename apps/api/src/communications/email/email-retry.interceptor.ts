/**
 * EmailRetryInterceptor — 3 retries with exponential backoff on 5xx
 * Task 3.3: Retries transient failures (5xx); no retry on permanent (4xx)
 */

import { Injectable, Logger } from '@nestjs/common';
import { EmailProvider, SendEmailInput, SendResult } from './interfaces/email-provider.interface';

@Injectable()
export class EmailRetryInterceptor {
  private readonly logger = new Logger(EmailRetryInterceptor.name);
  private readonly maxRetries = 3;
  private readonly baseDelayMs = 1000; // 1 second base

  /**
   * Send email with retry on transient failures
   * 5xx errors → retry with exponential backoff
   * 4xx errors → no retry (permanent failure)
   */
  async sendWithRetry(
    provider: EmailProvider,
    input: SendEmailInput,
  ): Promise<SendResult> {
    let lastResult: SendResult = { success: false, error: 'No attempt made' };

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      lastResult = await provider.send(input);

      if (lastResult.success) {
        return lastResult;
      }

      // Check if the error is a permanent (4xx) failure
      const isPermanent = this.isPermanentFailure(lastResult.error || '');
      if (isPermanent) {
        this.logger.warn(`Permanent failure on attempt ${attempt}: ${lastResult.error}`);
        return lastResult;
      }

      // Transient failure — retry with exponential backoff
      if (attempt < this.maxRetries) {
        const delayMs = this.baseDelayMs * Math.pow(2, attempt - 1);
        this.logger.warn(`Transient failure on attempt ${attempt}, retrying in ${delayMs}ms: ${lastResult.error}`);
        await this.sleep(delayMs);
      }
    }

    this.logger.error(`All ${this.maxRetries} attempts failed for email to ${input.to}`);
    return lastResult;
  }

  private isPermanentFailure(error: string): boolean {
    // 4xx errors, invalid recipient, auth errors → permanent
    const permanentPatterns = [/4\d{2}/, /invalid.*recipient/i, /authentication/i, /forbidden/i, /not found/i];
    return permanentPatterns.some((pattern) => pattern.test(error));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}