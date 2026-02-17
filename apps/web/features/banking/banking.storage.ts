import type { BankAccount } from "./banking.types";
import { emitBoStorageChange } from "@/shared/lib/storage/events";

const getStorageKey = (tenantId: string) => `bo_bank_accounts_${tenantId}`;

function safeParseArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export const listBankAccounts = (tenantId: string): BankAccount[] => {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(getStorageKey(tenantId));
  return safeParseArray<BankAccount>(raw);
};

export const addBankAccount = (
  tenantId: string,
  account: Omit<BankAccount, "id" | "createdAt">
): BankAccount => {
  const accounts = listBankAccounts(tenantId);

  const newAccount: BankAccount = {
    ...account,
    id: `ba_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    createdAt: new Date().toISOString(),
  };

  localStorage.setItem(getStorageKey(tenantId), JSON.stringify([...accounts, newAccount]));
  emitBoStorageChange();

  return newAccount;
};

export const removeBankAccount = (tenantId: string, id: string): void => {
  const accounts = listBankAccounts(tenantId);
  const filtered = accounts.filter((a) => a.id !== id);

  localStorage.setItem(getStorageKey(tenantId), JSON.stringify(filtered));
  emitBoStorageChange();
};
