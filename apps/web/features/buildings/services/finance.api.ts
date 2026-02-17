import { getToken } from '@/features/auth/session.storage';

/**
 * Finance API Service
 * Handles all Finanzas module operations (charges, payments, allocations, summary, ledger)
 */

function getHeaders(): HeadersInit {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : '',
  };
}

// ============================================================================
// TYPES
// ============================================================================

export enum ChargeStatus {
  PENDING = 'PENDING',
  PARTIAL = 'PARTIAL',
  PAID = 'PAID',
  CANCELED = 'CANCELED',
}

export enum PaymentStatus {
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  RECONCILED = 'RECONCILED',
}

export enum PaymentMethod {
  TRANSFER = 'TRANSFER',
  CASH = 'CASH',
  CARD = 'CARD',
  ONLINE = 'ONLINE',
}

export enum ChargeType {
  COMMON_EXPENSE = 'COMMON_EXPENSE',
  EXTRAORDINARY = 'EXTRAORDINARY',
  FINE = 'FINE',
  CREDIT = 'CREDIT',
  OTHER = 'OTHER',
}

export interface Charge {
  id: string;
  unitId: string;
  period: string;
  type: ChargeType;
  concept: string;
  amount: number;
  currency: string;
  dueDate: string;
  status: ChargeStatus;
  createdAt: string;
  updatedAt: string;
  canceledAt?: string;
}

export interface Payment {
  id: string;
  unitId?: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  reference?: string;
  proofFileId?: string;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
  createdByUser?: {
    id: string;
    name: string;
  };
  reviewedByMembership?: {
    id: string;
    user: { name: string };
  };
}

export interface PaymentAllocation {
  id: string;
  paymentId: string;
  chargeId: string;
  amount: number;
  charge?: {
    id: string;
    concept: string;
    amount: number;
    status: ChargeStatus;
    period: string;
  };
}

export interface FinancialSummary {
  totalCharges: number;
  totalPaid: number;
  totalOutstanding: number;
  delinquentUnitsCount: number;
  topDelinquentUnits: Array<{
    unitId: string;
    outstanding: number;
  }>;
  currency: string;
}

export interface UnitLedger {
  unitId: string;
  unitLabel: string;
  buildingId: string;
  buildingName: string;
  charges: Array<{
    id: string;
    period: string;
    concept: string;
    amount: number;
    type: ChargeType;
    status: ChargeStatus;
    dueDate: string;
    allocated: number;
  }>;
  payments: Array<{
    id: string;
    amount: number;
    method: PaymentMethod;
    status: PaymentStatus;
    createdAt: string;
    allocated: number;
  }>;
  totals: {
    totalCharges: number;
    totalAllocated: number;
    balance: number;
    currency: string;
  };
}

// ============================================================================
// CHARGES API
// ============================================================================

export async function listCharges(
  buildingId: string,
  period?: string,
  unitId?: string,
  status?: string,
  limit?: number,
  offset?: number,
): Promise<Charge[]> {
  const params = new URLSearchParams();
  if (period) params.append('period', period);
  if (unitId) params.append('unitId', unitId);
  if (status) params.append('status', status);
  if (limit) params.append('limit', limit.toString());
  if (offset) params.append('offset', offset.toString());

  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(
    `/api/buildings/${buildingId}/charges${query}`,
    { headers: getHeaders() }
  );

  if (!response.ok) {
    throw new Error(`Failed to list charges: ${response.statusText}`);
  }

  return response.json();
}

export async function createCharge(
  buildingId: string,
  data: {
    unitId: string;
    type: ChargeType;
    concept: string;
    amount: number;
    currency?: string;
    period?: string;
    dueDate: string;
  }
): Promise<Charge> {
  const response = await fetch(
    `/api/buildings/${buildingId}/charges`,
    {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to create charge: ${response.statusText}`);
  }

  return response.json();
}

export async function getCharge(
  buildingId: string,
  chargeId: string
): Promise<Charge> {
  const response = await fetch(
    `/api/buildings/${buildingId}/charges/${chargeId}`,
    { headers: getHeaders() }
  );

  if (!response.ok) {
    throw new Error(`Failed to get charge: ${response.statusText}`);
  }

  return response.json();
}

export async function cancelCharge(
  buildingId: string,
  chargeId: string
): Promise<void> {
  const response = await fetch(
    `/api/buildings/${buildingId}/charges/${chargeId}`,
    {
      method: 'DELETE',
      headers: getHeaders(),
      body: JSON.stringify({}),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to cancel charge: ${response.statusText}`);
  }
}

// ============================================================================
// PAYMENTS API
// ============================================================================

export async function listPayments(
  buildingId: string,
  status?: string,
  unitId?: string,
  limit?: number,
  offset?: number,
): Promise<Payment[]> {
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  if (unitId) params.append('unitId', unitId);
  if (limit) params.append('limit', limit.toString());
  if (offset) params.append('offset', offset.toString());

  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(
    `/api/buildings/${buildingId}/payments${query}`,
    { headers: getHeaders() }
  );

  if (!response.ok) {
    throw new Error(`Failed to list payments: ${response.statusText}`);
  }

  return response.json();
}

export async function submitPayment(
  buildingId: string,
  data: {
    unitId?: string;
    amount: number;
    currency?: string;
    method: PaymentMethod;
    reference?: string;
    paidAt?: string;
    proofFileId?: string;
  }
): Promise<Payment> {
  const response = await fetch(
    `/api/buildings/${buildingId}/payments`,
    {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to submit payment: ${response.statusText}`);
  }

  return response.json();
}

export async function getPayment(
  buildingId: string,
  paymentId: string
): Promise<Payment> {
  const response = await fetch(
    `/api/buildings/${buildingId}/payments/${paymentId}`,
    { headers: getHeaders() }
  );

  if (!response.ok) {
    throw new Error(`Failed to get payment: ${response.statusText}`);
  }

  return response.json();
}

export async function approvePayment(
  buildingId: string,
  paymentId: string,
  paidAt?: string
): Promise<Payment> {
  const response = await fetch(
    `/api/buildings/${buildingId}/payments/${paymentId}/approve`,
    {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ paidAt: paidAt || new Date().toISOString() }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to approve payment: ${response.statusText}`);
  }

  return response.json();
}

export async function rejectPayment(
  buildingId: string,
  paymentId: string,
  reason?: string
): Promise<Payment> {
  const response = await fetch(
    `/api/buildings/${buildingId}/payments/${paymentId}/reject`,
    {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ reason: reason || '' }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to reject payment: ${response.statusText}`);
  }

  return response.json();
}

// ============================================================================
// ALLOCATIONS API
// ============================================================================

export async function getPaymentAllocations(
  buildingId: string,
  paymentId: string
): Promise<PaymentAllocation[]> {
  const response = await fetch(
    `/api/buildings/${buildingId}/payments/${paymentId}/allocations`,
    { headers: getHeaders() }
  );

  if (!response.ok) {
    throw new Error(`Failed to get allocations: ${response.statusText}`);
  }

  return response.json();
}

export async function createAllocations(
  buildingId: string,
  paymentId: string,
  allocations: Array<{ chargeId: string; amount: number }>
): Promise<PaymentAllocation[]> {
  const response = await fetch(
    `/api/buildings/${buildingId}/payments/${paymentId}/allocations`,
    {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ allocations }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to create allocations: ${response.statusText}`);
  }

  return response.json();
}

// ============================================================================
// SUMMARY & REPORTING API
// ============================================================================

export async function getFinancialSummary(
  buildingId: string,
  period?: string
): Promise<FinancialSummary> {
  const query = period ? `?period=${period}` : '';
  const response = await fetch(
    `/api/buildings/${buildingId}/finance/summary${query}`,
    { headers: getHeaders() }
  );

  if (!response.ok) {
    throw new Error(`Failed to get financial summary: ${response.statusText}`);
  }

  return response.json();
}

// ============================================================================
// UNIT LEDGER API
// ============================================================================

export async function getUnitLedger(
  unitId: string,
  periodFrom?: string,
  periodTo?: string
): Promise<UnitLedger> {
  const params = new URLSearchParams();
  if (periodFrom) params.append('periodFrom', periodFrom);
  if (periodTo) params.append('periodTo', periodTo);

  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(
    `/api/units/${unitId}/ledger${query}`,
    { headers: getHeaders() }
  );

  if (!response.ok) {
    throw new Error(`Failed to get unit ledger: ${response.statusText}`);
  }

  return response.json();
}
