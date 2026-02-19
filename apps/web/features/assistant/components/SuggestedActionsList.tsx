'use client';

/**
 * SuggestedActionsList Component
 *
 * Renders suggested actions from AI assistant as clickable buttons.
 * Handles navigation, prefills, and error states.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SuggestedAction } from '../services/assistant.api';
import { handleSuggestedAction, getActionLabel, isActionAllowed } from '../handlers/aiActions';

interface SuggestedActionsListProps {
  actions: SuggestedAction[];
  tenantId: string;
  buildingId?: string;
  unitId?: string;
  permissions: string[];
}

interface ActionButtonState {
  loading: boolean;
  error?: string;
}

/**
 * Single action button with loading/error state
 */
function ActionButton({
  action,
  tenantId,
  buildingId,
  unitId,
  permissions,
  onResult,
}: {
  action: SuggestedAction;
  tenantId: string;
  buildingId?: string;
  unitId?: string;
  permissions: string[];
  onResult: (error?: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Check if user has permission for this action
  const allowed = isActionAllowed(action.type, permissions);
  if (!allowed) {
    // Don't render button if not allowed
    return null;
  }

  const handleClick = async () => {
    setLoading(true);
    try {
      const result = await handleSuggestedAction(action, {
        tenantId,
        buildingId,
        unitId,
        permissions,
        router,
      });

      if (!result.success) {
        onResult(result.error);
      } else {
        // Navigation will happen, clear any error
        onResult(undefined);
      }
    } catch (error) {
      onResult(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="inline-block px-3 py-2 text-sm rounded border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 transition mr-2 mb-2 disabled:opacity-50 disabled:cursor-not-allowed"
      title={action.type}
    >
      {loading ? '...' : getActionLabel(action.type)}
    </button>
  );
}

/**
 * Error message for action failure
 */
function ActionError({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  return (
    <div className="p-2 bg-amber-50 border border-amber-200 rounded text-sm text-amber-700 mb-2 flex justify-between items-start">
      <span>{error}</span>
      <button
        onClick={onDismiss}
        className="text-amber-700 hover:text-amber-900 font-bold ml-2"
      >
        ×
      </button>
    </div>
  );
}

/**
 * Main component: Render all suggested actions
 */
export function SuggestedActionsList({
  actions,
  tenantId,
  buildingId,
  unitId,
  permissions,
}: SuggestedActionsListProps) {
  const [actionError, setActionError] = useState<string>();

  if (!actions || actions.length === 0) {
    return null;
  }

  // Filter out actions user doesn't have permission for
  const allowedActions = actions.filter((a) => isActionAllowed(a.type, permissions));

  if (allowedActions.length === 0) {
    return null;
  }

  return (
    <div>
      {actionError && <ActionError error={actionError} onDismiss={() => setActionError(undefined)} />}

      <div className="flex flex-wrap gap-2">
        {allowedActions.map((action, i) => (
          <ActionButton
            key={i}
            action={action}
            tenantId={tenantId}
            buildingId={buildingId}
            unitId={unitId}
            permissions={permissions}
            onResult={setActionError}
          />
        ))}
      </div>
    </div>
  );
}
