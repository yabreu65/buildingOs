import { useQuery } from '@tanstack/react-query';
import {
  getBuildingDelinquency,
  type BuildingDelinquencyQuery,
} from '../services/finance.api';

/** Load one server-side page of operational building delinquency. */
export function useBuildingDelinquency(
  buildingId: string,
  query: BuildingDelinquencyQuery,
) {
  return useQuery({
    queryKey: ['buildingDelinquency', buildingId, query],
    queryFn: () => getBuildingDelinquency(buildingId, query),
    enabled: Boolean(buildingId && query.period),
    placeholderData: (previousData) => previousData,
  });
}
