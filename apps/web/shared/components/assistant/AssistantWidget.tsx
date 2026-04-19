'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Send, Bot, Sparkles, X, Minimize2, ArrowRight, ExternalLink } from 'lucide-react';
import type { AssistantMessage, AssistantAction, AssistantContext } from './useAssistant';
import { getAssistantActionPath } from './action-route-map';
import { createActionClickEvent, trackAssistantActionClick, getOrCreateSessionId } from './assistant-analytics';

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
  const router = useRouter();
  const params = useParams();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useLlm, setUseLlm] = useState(defaultUseLlm);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const tenantId = params?.tenantId as string | undefined || context.tenantId;
  
  const [sessionId] = useState(() => getOrCreateSessionId());

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
      const API_URL = process.env.NEXT_PUBLIC_ASSISTANT_API_URL || 'http://localhost:4001';
      
      const response = await fetch(`${API_URL}/assistant/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage.content,
          context,
          useLlm,
        }),
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }

      const data = await response.json();

      const assistantMessage: AssistantMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.answer,
        llmUsed: data.llmUsed,
        sources: data.knowledgeUsed?.sources,
        actions: data.actions || [],
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Error desconocido';
      setError(errorMsg);
      
      const errorMessage: AssistantMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${errorMsg}`,
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

  const handleActionClick = (action: AssistantAction, messageId: string, actionIndex: number, totalActions: number) => {
    const path = getAssistantActionPath(action.key, tenantId);
    const isMapped = path !== null;

    const event = createActionClickEvent({
      actionKey: action.key,
      actionLabel: action.label,
      tenantId,
      currentRoute: context.route,
      currentModule: context.currentModule,
      targetPath: path,
      isMapped,
      sessionId,
      messageId,
      actionIndex,
      totalActions,
    });

    trackAssistantActionClick(event);

    if (path) {
      router.push(path);
    }
  };

  return (
    <>
      {/* Toggle Button - Floating */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-colors ${className}`}
        aria-label={isOpen ? 'Cerrar asistente' : 'Abrir asistente'}
      >
        {isOpen ? <Minimize2 size={20} /> : <Bot size={20} />}
        {!isOpen && <span className="font-medium">Asistente</span>}
      </button>

      {/* Panel */}
      {isOpen && (
        <div className="fixed bottom-20 right-4 w-96 h-[500px] bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col z-50">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <Bot size={24} className="text-blue-600" />
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">Asistente AI</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">{context.role} • {context.currentModule || context.route}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={clearChat}
                className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                title="Limpiar chat"
              >
                <X size={18} />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                title="Minimizar"
              >
                <Minimize2 size={18} />
              </button>
            </div>
          </div>

          {/* LLM Toggle */}
          <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
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
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  
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
                      
                      {msg.role === 'assistant' && msg.actions && msg.actions.length > 0 && (
                        <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                          <div className="flex flex-wrap gap-2">
                            {msg.actions.map((action, actionIndex) => {
                              const path = getAssistantActionPath(action.key, tenantId);
                              const isMapped = path !== null;
                              const totalActions = msg.actions?.length ?? 0;
                              return (
                                <button
                                  key={action.key}
                                  onClick={() => handleActionClick(action, msg.id, actionIndex, totalActions)}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors ${
                                    isMapped
                                      ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/50 cursor-pointer'
                                      : 'bg-gray-50 border-gray-200 text-gray-500 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-500 cursor-not-allowed opacity-60'
                                  }`}
                                  title={action.description}
                                  disabled={!isMapped}
                                >
                                  {isMapped ? <ArrowRight size={12} /> : <ExternalLink size={12} />}
                                  {action.label}
                                </button>
                              );
                            })}
                          </div>
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
          <div className="p-4 border-t border-gray-200 dark:border-gray-700">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribí tu pregunta..."
                className="flex-1 min-h-[40px] max-h-[120px] resize-none rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                disabled={isLoading}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
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