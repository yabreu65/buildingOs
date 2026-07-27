/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import type { ReactNode, RefObject } from 'react';
import AppShell from './AppShell';

jest.mock('next/navigation', () => ({
  useParams: () => ({ tenantId: 'tenant-1' }),
  usePathname: () => '/tenant-1/resident/dashboard',
}));

jest.mock('./Sidebar', () => ({
  __esModule: true,
  default: ({ id, onNavigate, footer }: { id?: string; onNavigate?: () => void; footer?: ReactNode }) => (
    <aside id={id}>
      {onNavigate && <button type="button" onClick={onNavigate}>Ir a pagos</button>}
      {footer}
    </aside>
  ),
}));

jest.mock('./Topbar', () => ({
  __esModule: true,
  default: ({
    isMobileMenuOpen,
    menuButtonRef,
    onMobileMenuToggle,
  }: {
    isMobileMenuOpen: boolean;
    menuButtonRef: RefObject<HTMLButtonElement | null>;
    onMobileMenuToggle: () => void;
  }) => (
    <button
      ref={menuButtonRef}
      type="button"
      aria-label="Abrir menú de navegación"
      aria-controls="mobile-navigation"
      aria-expanded={isMobileMenuOpen}
      onClick={onMobileMenuToggle}
    >
      Menú
    </button>
  ),
}));

jest.mock('../../../features/impersonation/ImpersonationBanner', () => ({
  ImpersonationBanner: () => null,
}));

jest.mock('@/features/notifications/push-subscription.api', () => ({
  getExistingPushSubscription: jest.fn(),
  getVapidPublicKey: jest.fn(),
  isWebPushSupported: jest.fn(),
  subscribeToWebPush: jest.fn(),
  unsubscribeFromWebPush: jest.fn(),
  PushSubscriptionError: class PushSubscriptionError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

jest.mock('@/shared/components/assistant', () => {
  return {
    AssistantWidget: ({ suspendEscapeHandling = false }: { readonly suspendEscapeHandling?: boolean }) => {
      const [isOpen, setIsOpen] = React.useState(false);
      const [input, setInput] = React.useState('');
      const [messages, setMessages] = React.useState<string[]>([]);
      const toggleButtonRef = React.useRef<HTMLButtonElement>(null);
      const inputRef = React.useRef<HTMLTextAreaElement>(null);

      React.useEffect(() => {
        if (!isOpen) return;
        inputRef.current?.focus();
      }, [isOpen]);

      React.useEffect(() => {
        if (!isOpen || suspendEscapeHandling) return;

        const handleKeyDown = (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
            setIsOpen(false);
            requestAnimationFrame(() => toggleButtonRef.current?.focus());
          }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
      }, [isOpen, suspendEscapeHandling]);

      return (
        <div
          data-testid="assistant-widget"
          data-input={input}
          data-message-count={messages.length}
          data-open={isOpen}
        >
          <button
            ref={toggleButtonRef}
            type="button"
            aria-label={isOpen ? 'Cerrar asistente' : 'Abrir asistente'}
            aria-expanded={isOpen}
            onClick={() => setIsOpen((open: boolean) => !open)}
          >
            {isOpen ? 'Cerrar' : 'Abrir'}
          </button>
          {isOpen && (
            <div role="region" aria-label="Asistente AI">
              <textarea
                ref={inputRef}
                aria-label="Escribí tu pregunta"
                value={input}
                onChange={(event) => setInput(event.target.value)}
              />
              <button
                type="button"
                aria-label="Enviar mensaje"
                onClick={() => {
                  if (!input.trim()) return;
                  setMessages((current: string[]) => [...current, input.trim()]);
                  setInput('');
                }}
              >
                Enviar mensaje
              </button>
              <button
                type="button"
                aria-label="Minimizar asistente"
                onClick={() => {
                  setIsOpen(false);
                  requestAnimationFrame(() => toggleButtonRef.current?.focus());
                }}
              >
                Minimizar
              </button>
            </div>
          )}
        </div>
      );
    },
    useAssistantContext: () => ({}),
  };
});

jest.mock('@/features/notifications/components/PushPermissionControl', () => ({
  PushPermissionControl: () => null,
}));

const openDrawer = () => {
  const trigger = screen.getByRole('button', { name: 'Abrir menú de navegación' });
  fireEvent.click(trigger);
  return trigger;
};

const openAssistant = () => {
  const trigger = screen.getByRole('button', { name: 'Abrir asistente' });
  fireEvent.click(trigger);
  return trigger;
};

describe('AppShell mobile drawer', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });

  it('mounts the drawer only when opened and unmounts it again on close', () => {
    render(<AppShell>Contenido</AppShell>);

    expect(screen.queryByTestId('mobile-navigation-drawer')).toBeNull();

    openDrawer();

    const drawer = screen.getByTestId('mobile-navigation-drawer');
    expect(drawer).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Navegación principal' })).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar menú' }));

    expect(screen.queryByTestId('mobile-navigation-drawer')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('moves focus into the drawer and traps Tab in both directions', () => {
    render(<AppShell>Contenido</AppShell>);
    openDrawer();

    const closeButton = screen.getByRole('button', { name: 'Cerrar menú' });
    const lastControl = screen.getByRole('button', { name: 'Ir a pagos' });

    expect(document.activeElement).toBe(closeButton);

    lastControl.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastControl);
  });

  it('recalculates focusable drawer controls on every Tab event', () => {
    render(<AppShell>Contenido</AppShell>);
    openDrawer();

    const drawer = screen.getByRole('dialog', { name: 'Navegación principal' });
    const closeButton = screen.getByRole('button', { name: 'Cerrar menú' });
    const dynamicControl = document.createElement('button');
    dynamicControl.type = 'button';
    dynamicControl.textContent = 'Control dinámico';
    drawer.appendChild(dynamicControl);

    dynamicControl.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(dynamicControl);
  });

  it('closes the drawer and restores scroll when the desktop breakpoint becomes active', async () => {
    let changeListener: ((event: MediaQueryListEvent) => void) | undefined;
    const addEventListener = jest.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
      if (event === 'change') changeListener = listener;
    });
    const removeEventListener = jest.fn();
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn(() => ({
        matches: false,
        addEventListener,
        removeEventListener,
      })),
    });

    try {
      render(<AppShell>Contenido</AppShell>);
      const trigger = openDrawer();
      const triggerFocus = jest.spyOn(trigger, 'focus');
      triggerFocus.mockClear();

      expect(document.body.style.overflow).toBe('hidden');
      act(() => {
        changeListener?.({ matches: true } as MediaQueryListEvent);
      });

      await waitFor(() => {
        expect(screen.queryByTestId('mobile-navigation-drawer')).toBeNull();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(document.body.style.overflow).toBe('');
      });
      expect(triggerFocus).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
    }
  });

  it('removes the desktop breakpoint listener on unmount', () => {
    const removeEventListener = jest.fn();
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn(() => ({
        matches: false,
        addEventListener: jest.fn(),
        removeEventListener,
      })),
    });

    try {
      const { unmount } = render(<AppShell>Contenido</AppShell>);
      unmount();
      expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
    }
  });

  it('suppresses the assistant surface without unmounting it while the drawer is open', () => {
    render(<AppShell>Contenido</AppShell>);
    const assistantSurface = screen.getByTestId('assistant-shell-surface');
    const assistantWidget = screen.getByTestId('assistant-widget');

    expect(assistantSurface.getAttribute('aria-hidden')).toBe('false');
    expect(assistantWidget.getAttribute('data-open')).toBe('false');

    openDrawer();
    expect(assistantSurface.getAttribute('aria-hidden')).toBe('true');
    expect(assistantSurface.className).toContain('invisible');
    expect(assistantSurface.className).toContain('pointer-events-none');

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar menú' }));
    expect(assistantSurface.getAttribute('aria-hidden')).toBe('false');
  });

  it('locks body scroll and restores trigger focus after Escape', async () => {
    render(<AppShell>Contenido</AppShell>);
    const trigger = openDrawer();

    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTestId('mobile-navigation-drawer')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('returns focus to the trigger after closing from the overlay or close button', async () => {
    render(<AppShell>Contenido</AppShell>);
    const trigger = openDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar menú de navegación' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar menú' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('closes after navigation without returning focus to the previous page trigger', () => {
    render(<AppShell>Contenido</AppShell>);
    const trigger = openDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Ir a pagos' }));

    expect(screen.queryByTestId('mobile-navigation-drawer')).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });

  it('restores the previous body overflow when unmounted while open', () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = render(<AppShell>Contenido</AppShell>);

    openDrawer();
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('keeps horizontal scrolling on exactly the content layer', () => {
    const { container } = render(<AppShell>Contenido</AppShell>);
    const root = container.firstElementChild;
    const main = container.querySelector('main');
    const horizontalScrollLayers = container.querySelectorAll('.overflow-x-auto');

    expect(root?.className).toContain('min-h-dvh');
    expect(root?.className).not.toContain('min-h-screen');
    expect(main?.className).toContain('min-w-0');
    expect(horizontalScrollLayers).toHaveLength(1);
    expect(horizontalScrollLayers[0]?.className).toContain('min-w-0');
  });

  it('keeps the assistant open while the drawer is open and only closes it after a second Escape', async () => {
    render(<AppShell>Contenido</AppShell>);
    const assistantTrigger = openAssistant();

    fireEvent.change(screen.getByLabelText('Escribí tu pregunta'), { target: { value: 'Mensaje persistente' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));

    await waitFor(() => {
      expect(screen.getByTestId('assistant-widget').getAttribute('data-open')).toBe('true');
      expect(screen.getByTestId('assistant-widget').getAttribute('data-message-count')).toBe('1');
    });

    const drawerTrigger = openDrawer();
    expect(screen.getByTestId('assistant-shell-surface').getAttribute('aria-hidden')).toBe('true');

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('mobile-navigation-drawer')).toBeNull();
      expect(document.activeElement).toBe(drawerTrigger);
      expect(screen.getByTestId('assistant-widget').getAttribute('data-open')).toBe('true');
      expect(screen.getByTestId('assistant-widget').getAttribute('data-message-count')).toBe('1');
    });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.getByTestId('assistant-widget').getAttribute('data-open')).toBe('false');
      expect(screen.getByRole('button', { name: 'Abrir asistente' })).toBe(assistantTrigger);
    });
  });
});
