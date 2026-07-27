/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssistantWidget } from './AssistantWidget';
import { assistantApi } from '@/features/assistant/services/assistant.api';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ tenantId: 'tenant-1' }),
}));

jest.mock('@/features/assistant/services/assistant.api', () => ({
  assistantApi: { chatV2: jest.fn() },
  AssistantApiError: class AssistantApiError extends Error {},
}));

jest.mock('./assistant-analytics', () => ({
  createActionClickEvent: jest.fn(),
  trackAssistantActionClick: jest.fn(),
  getOrCreateSessionId: () => 'session-1',
}));

jest.mock('./renderers', () => ({
  AssistantResponseRenderer: () => null,
}));

const mockChatV2 = jest.mocked(assistantApi.chatV2);

const context = {
  appId: 'buildingos',
  tenantId: 'tenant-1',
  userId: 'user-1',
  role: 'RESIDENT',
  route: '/tenant-1/resident/dashboard',
  currentModule: 'Panel',
};

describe('AssistantWidget responsive panel', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockChatV2.mockResolvedValue({
      type: 'text',
      title: 'Respuesta',
      summary: 'Respuesta',
      actions: [],
      meta: { intent: 'help', confidence: 1, tenantScoped: true },
    });
  });

  it('uses a viewport-contained mobile panel and retains a bounded desktop size', () => {
    render(<AssistantWidget context={context} />);

    const trigger = screen.getByRole('button', { name: 'Abrir asistente' });
    const triggerClasses = trigger.className.split(' ');
    fireEvent.click(trigger);

    const panel = screen.getByRole('region', { name: 'Asistente AI' });
    const classes = panel.className.split(' ');

    expect(classes).toContain('inset-x-2');
    expect(classes).toContain('max-h-[calc(100dvh-env(safe-area-inset-top)-5rem)]');
    expect(classes).toContain('sm:w-96');
    expect(classes).not.toContain('w-96');
    expect(triggerClasses).not.toContain('inset-x-2');
    expect(triggerClasses).toContain('right-2');
    expect(triggerClasses).toContain('min-h-11');
    expect(triggerClasses).not.toContain('w-full');
    expect(screen.getByLabelText('Escribí tu pregunta')).toBe(document.activeElement);
  });

  it('keeps the LLM control touch-sized and closes with Escape while restoring trigger focus', async () => {
    render(<AssistantWidget context={context} />);
    const trigger = screen.getByRole('button', { name: 'Abrir asistente' });

    fireEvent.click(trigger);

    const llmLabel = screen.getByText('Usar generación avanzada (LLM)').closest('label');
    const llmCheckbox = screen.getByRole('checkbox');
    expect(llmLabel?.className).toContain('min-h-11');
    expect((llmCheckbox as HTMLInputElement).checked).toBe(false);

    fireEvent.click(llmCheckbox);
    expect((llmCheckbox as HTMLInputElement).checked).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Asistente AI' })).toBeNull();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('suspends Escape handling without resetting state and resumes it without stealing focus', async () => {
    const { rerender } = render(
      <>
        <button type="button">Fuera</button>
        <AssistantWidget context={context} suspendEscapeHandling />
      </>,
    );

    const trigger = screen.getByRole('button', { name: 'Abrir asistente' });
    const outsideButton = screen.getByRole('button', { name: 'Fuera' });

    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText('Escribí tu pregunta'), { target: { value: 'Necesito ayuda' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));

    await waitFor(() => {
      expect(mockChatV2).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ message: 'Necesito ayuda' }));
      expect(screen.getByText('Necesito ayuda')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Escribí tu pregunta'), { target: { value: 'Borrador' } });
    outsideButton.focus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Cerrar asistente' }).getAttribute('aria-expanded')).toBe('true');
    expect((screen.getByLabelText('Escribí tu pregunta') as HTMLTextAreaElement).value).toBe('Borrador');
    expect(screen.getByText('Necesito ayuda')).toBeTruthy();

    rerender(
      <>
        <button type="button">Fuera</button>
        <AssistantWidget context={context} suspendEscapeHandling={false} />
      </>,
    );

    expect(document.activeElement).toBe(outsideButton);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Asistente AI' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Abrir asistente' }).getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abrir asistente' }));
    });
  });

  it('keeps close and message submission controls operational', async () => {
    render(<AssistantWidget context={context} />);
    const trigger = screen.getByRole('button', { name: 'Abrir asistente' });

    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText('Escribí tu pregunta'), { target: { value: 'Necesito ayuda' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));

    await waitFor(() => {
      expect(mockChatV2).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ message: 'Necesito ayuda' }));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Minimizar asistente' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
