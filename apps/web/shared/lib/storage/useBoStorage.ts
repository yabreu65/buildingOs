"use client";

import { useSyncExternalStore } from "react";
import { subscribeBoStorageChange } from "./events";

// Variable mutable externa para trackear versión
let storageVersion = 0;

// Escuchar evento globalmente y actualizar versión
if (typeof window !== "undefined") {
  const handler = () => {
    storageVersion = Date.now();
  };
  window.addEventListener("bo:storage", handler);
  window.addEventListener("storage", handler);
}

function getSnapshot(): number {
  return storageVersion;
}

function getServerSnapshot(): number {
  return 0;
}

/**
 * Hook genérico para re-renderizar cuando cambie el storage.
 * Usa una variable externa estable como source of truth para evitar
 * retornar un nuevo valor (Date.now()) en cada llamada a getSnapshot.
 */
export function useBoStorageTick(): number {
  return useSyncExternalStore(subscribeBoStorageChange, getSnapshot, getServerSnapshot);
}
