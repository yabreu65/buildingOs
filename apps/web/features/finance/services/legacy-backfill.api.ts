/**
 * FIN-07A: API client para Legacy income backfill (FIN-04).
 * Endpoints:
 *   GET  /tenants/:tenantId/finance/incomes/legacy-backfill/preview
 *   POST /tenants/:tenantId/finance/incomes/legacy-backfill/apply
 */

import { apiClient } from '@/shared/lib/http/client';
import { parseLegacyBackfillPreview, parseLegacyBackfillResults } from '../contracts/finance-guards';
import type {
  LegacyBackfillApplyItem,
  LegacyBackfillApplyResultItem,
  LegacyBackfillPreviewItem,
  LegacyBackfillPreviewQuery,
} from '../contracts/finance-types';

export function previewLegacyIncomeBackfill(
  tenantId: string,
  query: LegacyBackfillPreviewQuery = {},
): Promise<LegacyBackfillPreviewItem[]> {
  const searchParams = new URLSearchParams();
  if (query.period) searchParams.set('period', query.period);
  if (query.categoryId) searchParams.set('categoryId', query.categoryId);
  if (query.destination) searchParams.set('destination', query.destination);
  const qs = searchParams.toString();
  return apiClient<unknown>({
    path: `/tenants/${tenantId}/finance/incomes/legacy-backfill/preview${qs ? `?${qs}` : ''}`,
    method: 'GET',
  }).then(parseLegacyBackfillPreview);
}

export function applyLegacyIncomeBackfill(
  tenantId: string,
  items: LegacyBackfillApplyItem[],
): Promise<LegacyBackfillApplyResultItem[]> {
  return apiClient<unknown, { items: LegacyBackfillApplyItem[] }>({
    path: `/tenants/${tenantId}/finance/incomes/legacy-backfill/apply`,
    method: 'POST',
    body: { items },
  }).then(parseLegacyBackfillResults);
}
