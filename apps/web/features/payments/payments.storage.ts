import { emitBoStorageChange } from "@/shared/lib/storage/events";
import type { Payment } from "./payments.types";

const getStorageKey = (tenantId: string) => `bo_payments_${tenantId}`;

function safeParseArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function listPayments(tenantId: string): Payment[] {
  if (typeof window === "undefined") return [];
  return safeParseArray<Payment>(localStorage.getItem(getStorageKey(tenantId)));
}

export function submitPayment(
  tenantId: string,
  input: Omit<Payment, "id" | "status" | "createdAt">
): Payment {
  const items = listPayments(tenantId);

  const newItem: Payment = {
    id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    unitId: input.unitId,
    amount: input.amount,
    status: "PENDING",
    createdAt: new Date().toISOString(),
  };

  localStorage.setItem(getStorageKey(tenantId), JSON.stringify([newItem, ...items]));
  emitBoStorageChange();

  return newItem;
}

export function setPaymentStatus(
  tenantId: string,
  paymentId: string,
  status: Payment["status"]
): Payment[] {
  const items = listPayments(tenantId);

  const updated = items.map((p) => (p.id === paymentId ? { ...p, status } : p));

  localStorage.setItem(getStorageKey(tenantId), JSON.stringify(updated));
  emitBoStorageChange();

  return updated;
}

export function removePayment(tenantId: string, paymentId: string): void {
  const items = listPayments(tenantId);
  const filtered = items.filter((p) => p.id !== paymentId);

  localStorage.setItem(getStorageKey(tenantId), JSON.stringify(filtered));
  emitBoStorageChange();
}
