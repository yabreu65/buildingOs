import { emitBoStorageChange } from "@/shared/lib/storage/events";
import type { Property } from "./properties.types";

const getStorageKey = (tenantId: string) => `bo_properties_${tenantId}`;

function safeParseArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function listProperties(tenantId: string): Property[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(getStorageKey(tenantId));
  return safeParseArray<Property>(raw);
}

export function addProperty(
  tenantId: string,
  input: Omit<Property, "id">
): Property {
  const items = listProperties(tenantId);

  const newItem: Property = {
    id: `prop_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    name: input.name,
    address: input.address,
    units: input.units,
  };

  localStorage.setItem(getStorageKey(tenantId), JSON.stringify([...items, newItem]));
  emitBoStorageChange();

  return newItem;
}

export function removeProperty(tenantId: string, id: string): void {
  const items = listProperties(tenantId);
  const filtered = items.filter((p) => p.id !== id);

  localStorage.setItem(getStorageKey(tenantId), JSON.stringify(filtered));
  emitBoStorageChange();
}
