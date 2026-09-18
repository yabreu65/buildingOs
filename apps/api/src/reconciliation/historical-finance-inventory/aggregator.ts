import {
  FinanceClassification,
  FinanceClassificationDecision,
} from './classifier';
import { createClassificationTotals } from './result';

/** Maintains bounded aggregate finding totals without retaining source findings. */
export class HistoricalFinanceFindingAggregator {
  private readonly totals = createClassificationTotals();
  private readonly categories: Record<string, number> = {};
  private recorded = 0;
  private truncated = false;

  constructor(private readonly maxFindings: number) {}

  record(decision: FinanceClassificationDecision): void {
    if (decision.classification === 'SAFE') {
      this.totals.SAFE += 1;
      return;
    }
    if (this.recorded >= this.maxFindings) {
      this.truncated = true;
      return;
    }
    this.recorded += 1;
    this.totals[decision.classification] += 1;
    this.categories[decision.category] = (this.categories[decision.category] ?? 0) + 1;
  }

  classificationTotals(): Record<FinanceClassification, number> {
    return this.totals;
  }

  findingCategoryCounts(): Record<string, number> {
    return this.categories;
  }

  recordedFindings(): number {
    return this.recorded;
  }

  findingsTruncated(): boolean {
    return this.truncated;
  }
}
