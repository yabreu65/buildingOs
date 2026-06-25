import type { BuildingAlert } from '../services/dashboard.api';

export const getTotalAccumulatedDebt = (buildingAlerts: BuildingAlert[]): number =>
  buildingAlerts.reduce((sum, alert) => sum + (alert.outstandingAmount || 0), 0);
