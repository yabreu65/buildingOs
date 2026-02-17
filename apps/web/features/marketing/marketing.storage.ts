import { emitBoStorageChange } from "@/shared/lib/storage/events";
import type { Lead } from "./marketing.types";

const STORAGE_KEY = "bo_leads";

function safeParseArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function listLeads(): Lead[] {
  if (typeof window === "undefined") return [];
  return safeParseArray<Lead>(localStorage.getItem(STORAGE_KEY));
}

export function addLead(lead: Lead): void {
  const leads = listLeads();
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...leads, lead]));
  emitBoStorageChange();
}
