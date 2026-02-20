'use client';

/**
 * AssistantWidget Component
 *
 * Global AI Assistant widget for tenant routes.
 * - Pulls context from ContextSelector (activeBuilding, activeUnit, currentPage)
 * - Displays chat interface with answer and suggested actions
 * - Actions routed through AI Actions Bridge for validation and navigation
 * - Handles errors (feature not available, rate limit, provider errors)
 * - Never auto-executes mutations, only opens UI with prefills
 */

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAssistant } from '../hooks/useAssistant';
import { SuggestedActionsList } from './SuggestedActionsList';
import { useAiNudges } from '../hooks/useAiNudges';

interface AssistantWidgetProps {
  tenantId: string;
  currentPage: string;
  buildingId?: string;
  unitId?: string;
  permissions?: string[]; // User permissions for action validation
  isOpen?: boolean;
  onClose?: () => void;
}

// Actions rendering moved to SuggestedActionsList component
// which handles validation, permissions, navigation, and error states

/**
 * Error message component
 */
function ErrorMessage({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  return (
    <div className="p-3 bg-red-50 border border-red-200 rounded mb-4 text-sm text-red-700">
      <div className="flex justify-between items-start">
        <p>{error}</p>
        <button
          onClick={onDismiss}
          className="text-red-700 hover:text-red-900 font-bold"
        >
          ×
        </button>
      </div>
    </div>
  );
}

/**
 * Loading skeleton for response
 */
function ResponseSkeleton() {
  return (
    <div className="space-y-3 mb-4">
      <div className="h-4 bg-gray-200 rounded w-3/4 animate-pulse"></div>
      <div className="h-4 bg-gray-200 rounded w-full animate-pulse"></div>
      <div className="h-4 bg-gray-200 rounded w-2/3 animate-pulse"></div>
    </div>
  );
}

/**
 * Main widget component
 */
export function AssistantWidget({
  tenantId,
  currentPage,
  buildingId,
  unitId,
  permissions = [],
  isOpen = true,
  onClose,
}: AssistantWidgetProps) {
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState(isOpen);
  const inputRef = useRef<HTMLInputElement>(null);
  const { loading, error, answer, suggestedActions, sendMessage, clearError, reset } =
    useAssistant(tenantId);
  const { nudges, submitting, requestUpgrade } = useAiNudges(tenantId);
  const blockNudge = nudges.find((nudge) => nudge.severity === 'BLOCK');

  // Focus input when expanded
  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || blockNudge) return;

    const msg = message;
    setMessage('');

    await sendMessage(msg, {
      page: currentPage,
      buildingId,
      unitId,
    });
  };

  const handleClose = () => {
    setExpanded(false);
    reset();
    if (onClose) onClose();
  };

  return (
    <div className="fixed bottom-4 right-4 max-w-sm">
      {/* Toggle Button */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-12 h-12 rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 transition flex items-center justify-center"
          title="Open AI Assistant"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </button>
      )}

      {/* Widget Panel */}
      {expanded && (
        <div className="bg-white rounded-lg shadow-xl border border-gray-200 w-full max-w-sm">
          {/* Header */}
          <div className="flex justify-between items-center p-4 border-b">
            <h3 className="font-semibold text-gray-800">AI Assistant</h3>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 text-xl"
            >
              ×
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
            {blockNudge && (
              <div className="p-3 rounded border border-red-200 bg-red-50">
                <p className="text-sm font-semibold text-red-900">{blockNudge.title}</p>
                <p className="text-sm text-red-800 mt-1">{blockNudge.message}</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded text-sm bg-white border border-red-300 text-red-700 disabled:opacity-60"
                    disabled={submitting}
                    onClick={() => {
                      void requestUpgrade();
                    }}
                  >
                    Solicitar upgrade
                  </button>
                  <Link
                    href={`/${tenantId}/support?topic=ai-limit`}
                    className="px-3 py-1.5 rounded text-sm bg-white border border-red-300 text-red-700"
                  >
                    Contactar soporte
                  </Link>
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && <ErrorMessage error={error} onDismiss={clearError} />}

            {/* Loading State */}
            {loading && <ResponseSkeleton />}

            {/* Answer */}
            {answer && !loading && (
              <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded">
                <p>{answer}</p>
              </div>
            )}

            {/* Suggested Actions - Routed through AI Actions Bridge */}
            {suggestedActions.length > 0 && !loading && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">
                  Suggested actions:
                </p>
                <SuggestedActionsList
                  actions={suggestedActions}
                  tenantId={tenantId}
                  buildingId={buildingId}
                  unitId={unitId}
                  permissions={permissions}
                />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-4 border-t">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={blockNudge ? 'IA pausada por limite mensual' : 'Ask me anything...'}
                disabled={loading || Boolean(blockNudge)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading || !message.trim() || Boolean(blockNudge)}
                className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition disabled:opacity-50"
              >
                {loading ? '...' : 'Send'}
              </button>
            </form>
            <p className="text-xs text-gray-500 mt-2">
              Powered by AI. Always verify information before acting.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
