'use client';

import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  toast: (message: string, type: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback(
    (message: string, type: ToastType, duration = 3000) => {
      const id = Date.now().toString();
      const newToast: Toast = { id, message, type };

      setToasts((prev) => [...prev, newToast]);

      if (duration > 0) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, duration);
      }
    },
    []
  );

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const getBackgroundColor = (type: ToastType): string => {
    switch (type) {
      case 'success':
        return 'bg-green-500 text-white';
      case 'error':
        return 'bg-red-500 text-white';
      case 'info':
        return 'bg-blue-500 text-white';
    }
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed top-4 left-4 right-4 z-50 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={[
              'mb-2 px-4 py-3 rounded-lg shadow-lg flex items-center justify-between',
              'pointer-events-auto animate-in fade-in slide-in-from-top',
              getBackgroundColor(t.type),
            ].join(' ')}
          >
            <span className="text-sm font-medium">{t.message}</span>
            <button
              onClick={() => removeToast(t.id)}
              className="ml-4 inline-flex items-center justify-center hover:opacity-80 transition"
            >
              <X size={18} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}
