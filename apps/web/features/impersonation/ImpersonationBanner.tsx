'use client';

import { useImpersonation } from './useImpersonation';

export function ImpersonationBanner() {
  const { isImpersonating, metadata, endImpersonation } = useImpersonation();

  if (!isImpersonating || !metadata) {
    return null;
  }

  const expiresIn = Math.floor(
    (new Date(metadata.expiresAt).getTime() - Date.now()) / 1000 / 60,
  );

  return (
    <div className="bg-amber-100 border-b border-amber-400 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-amber-800">
          <svg
            className="w-5 h-5"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span className="font-semibold">Modo Soporte</span>
        </div>
        <span className="text-amber-800">
          Impersonando: <strong>{metadata.tenantName}</strong>
        </span>
        <span className="text-amber-600 text-sm">
          (expira en {Math.max(0, expiresIn)} min)
        </span>
      </div>
      <button
        onClick={() => endImpersonation()}
        className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded transition-colors"
      >
        Salir de Impersonation
      </button>
    </div>
  );
}
