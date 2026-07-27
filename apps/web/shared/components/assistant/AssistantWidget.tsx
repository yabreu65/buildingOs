'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Send, Bot, Sparkles, X, Minimize2 } from 'lucide-react';
import type { AssistantMessage, AssistantContext } from './useAssistant';
import { assistantApi, AssistantApiError } from '@/features/assistant/services/assistant.api';
import { AssistantResponseRenderer } from './renderers';

export interface AssistantWidgetProps {
  context: AssistantContext;
  defaultUseLlm?: boolean;
  className?: string;
}

export function AssistantWidget({ 
  context, 
  defaultUseLlm = false,
  className = '' 
}: AssistantWidgetProps) {
  const params = useParams();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useLlm, setUseLlm] = useState(defaultUseLlm);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);

  const tenantId = params?.tenantId as string | undefined || context.tenantId;
  
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const closeAssistant = useCallback((restoreFocus = true) => {
    setIsOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => toggleButtonRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    inputRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAssistant();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [closeAssistant, isOpen]);

  const [conversationId] = useState(() => `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: AssistantMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      if (!tenantId) {
        throw new Error('No tenant ID available');
      }
      
      // Use v2 endpoint for structured responses
      const response = await assistantApi.chatV2(tenantId, {
        message: userMessage.content,
        page: context.page || 'dashboard',
        currentPage: context.currentPage,
        buildingId: context.buildingId,
        unitId: context.unitId,
        financePeriod: context.financePeriod,
        conversationId,
      });

      const assistantMessage: AssistantMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.summary,
        structuredResponse: response,
        actions: response.actions?.map((action) => ({
          key: action.action,
          label: action.label,
          payload: action.payload as Record<string, unknown>,
        })) || [],
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      let errorContent: string;
      let isFeatureError = false;

      if (err instanceof AssistantApiError) {
        switch (err.code) {
          case 'FEATURE_NOT_AVAILABLE':
            errorContent = '🚫 El asistente AI no está disponible en tu plan actual. Actualizá a Enterprise para usarlo.';
            isFeatureError = true;
            break;
          case 'AI_RATE_LIMITED':
            errorContent = '⏳ Límite de consultas alcanzado. Intentá mañana o contactá al administrador.';
            break;
          default:
            errorContent = `❌ ${err.message}`;
        }
      } else if (err instanceof Error) {
        errorContent = `❌ ${err.message}`;
      } else {
        errorContent = '❌ Error desconocido';
      }

      setError(errorContent);

      const errorMessage: AssistantMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: errorContent,
        // For feature errors, show as clarification so user can take action
        structuredResponse: isFeatureError ? {
          type: 'clarification',
          title: 'Funcionalidad no disponible',
          summary: errorContent,
          data: [
            { label: 'Ver planes disponibles', value: '/billing' },
          ],
          meta: {
            intent: 'error',
            confidence: 1,
            tenantScoped: true,
          },
        } : undefined,
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <>
      {/* Toggle Button - Floating */}
      <button
        ref={toggleButtonRef}
        type="button"
        onClick={() => (isOpen ? closeAssistant(false) : setIsOpen(true))}
        className={`fixed right-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-50 flex min-h-11 max-w-[calc(100vw-1rem)] items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 sm:bottom-4 sm:right-4 sm:w-auto ${className}`}
        aria-label={isOpen ? 'Cerrar asistente' : 'Abrir asistente'}
        aria-expanded={isOpen}
        aria-controls="assistant-panel"
      >
        {isOpen ? <Minimize2 size={20} /> : <Bot size={20} />}
        {!isOpen && <span className="font-medium">Asistente</span>}
      </button>

      {/* Panel */}
      {isOpen && (
        <div
          id="assistant-panel"
          role="region"
          aria-label="Asistente AI"
          className="fixed inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] z-50 flex max-h-[calc(100dvh-env(safe-area-inset-top)-5rem)] min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl sm:inset-x-auto sm:bottom-20 sm:right-4 sm:h-[min(500px,calc(100dvh-6rem))] sm:w-96"
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-border p-4">
            <div className="flex min-w-0 items-center gap-2">
              <Bot size={24} className="text-blue-600" />
              <div className="min-w-0">
                <h3 className="truncate font-semibold">Asistente AI</h3>
                <p className="truncate text-xs text-muted-foreground">{context.role} • {context.currentModule || context.route}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clearChat}
                className="inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                title="Limpiar chat"
                aria-label="Limpiar chat"
              >
                <X size={18} />
              </button>
              <button
                type="button"
                onClick={() => closeAssistant()}
                className="inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                title="Minimizar"
                aria-label="Minimizar asistente"
              >
                <Minimize2 size={18} />
              </button>
            </div>
          </div>

          {/* LLM Toggle */}
          <div className="shrink-0 border-b border-border bg-muted/50 px-4 py-2">
            <label className="flex min-h-11 min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={useLlm}
                onChange={(e) => setUseLlm(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <Sparkles size={16} className={useLlm ? 'text-purple-500' : 'text-gray-400'} />
              <span>Usar generación avanzada (LLM)</span>
            </label>
          </div>

          {/* Messages */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                <Bot size={40} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">¿En qué puedo ayudarte con {context.currentModule || 'este módulo'}?</p>
              </div>
            )}
            
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                  }`}
                >
                  {msg.structuredResponse ? (
                    <AssistantResponseRenderer
                      response={msg.structuredResponse}
                      onClarificationSelect={(value) => {
                        setInput(value);
                        setTimeout(() => sendMessage(), 100);
                      }}
                      onAction={(action, payload) => {
                        // Handle action clicks from structured response
                        console.log('Action:', action, payload);
                      }}
                    />
                  ) : (
                    <p className="break-words text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}
                  
                  {msg.role === 'assistant' && msg.llmUsed !== undefined && (
                    <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                      <div className="flex items-center gap-2 text-xs">
                        {msg.llmUsed ? (
                          <>
                            <Sparkles size={12} className="text-purple-500" />
                            <span className="text-purple-600 dark:text-purple-400">Generado con AI</span>
                          </>
                        ) : (
                          <>
                            <Bot size={12} className="text-gray-400" />
                            <span className="text-gray-500">Respuesta basada en conocimiento</span>
                          </>
                        )}
                      </div>
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-1 text-xs text-gray-500">
                          Fuentes: {msg.sources.map(s => s.fileName).join(', ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    <span className="text-sm text-gray-500">Pensando...</span>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex min-w-0 gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribí tu pregunta..."
                className="min-h-11 min-w-0 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={isLoading}
                aria-label="Escribí tu pregunta"
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Enviar mensaje"
              >
                <Send size={20} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
