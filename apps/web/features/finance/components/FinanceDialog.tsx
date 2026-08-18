'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface FinanceDialogProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly labelledBy: string;
}

export function FinanceDialog({ title, children, onClose, labelledBy }: FinanceDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-background p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={labelledBy} className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label={`Cerrar diálogo: ${title}`} className="rounded p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
