'use client';

import { useState } from 'react';
import { logout } from '@/features/auth/login.actions';
import { useRouter } from 'next/navigation';

interface UserMenuProps {
  email: string;
  name?: string;
}

export function UserMenu({ email, name }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <div className="relative">
      {/* User Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 rounded-lg hover:bg-accent/50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-bold">
            {email.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{name || 'Super Admin'}</p>
            <p className="text-xs text-muted-foreground truncate">{email}</p>
          </div>
          <span className="text-lg">{isOpen ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-border rounded-lg shadow-lg overflow-hidden z-50">
          <div className="p-4 border-b border-border bg-muted/30">
            <p className="text-sm font-semibold text-foreground">Conectado como</p>
            <p className="text-xs text-muted-foreground mt-1">{email}</p>
          </div>

          <button
            onClick={handleLogout}
            className="w-full px-4 py-3 text-left text-sm font-medium text-red-600 hover:bg-red-50/20 transition-colors flex items-center gap-2"
          >
            <span>🚪</span>
            Cerrar sesión
          </button>
        </div>
      )}

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}
