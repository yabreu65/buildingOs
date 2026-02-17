export const BO_STORAGE_EVENT = "bo:storage";

export function emitBoStorageChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(BO_STORAGE_EVENT));
}

export function subscribeBoStorageChange(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const handler = () => {
    onStoreChange();
  };

  window.addEventListener("storage", handler);
  window.addEventListener(BO_STORAGE_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(BO_STORAGE_EVENT, handler);
  };
}
