'use client';

/**
 * AI Unit Assistant Component
 *
 * Specialized AI assistance for unit management:
 * - Unit configuration suggestions
 * - Resident risk assessment
 * - Rent price optimization
 * - Maintenance predictions
 *
 * Displays suggestions in a collapsible card with detailed analysis.
 * Never blocks user actions - purely informational/advisory.
 */

import { useState, useEffect } from 'react';
import { Loader, AlertCircle, TrendingUp, AlertTriangle, Wrench } from 'lucide-react';

export type AiUnitAssistantType = 'suggestions' | 'pricing' | 'resident-risk' | 'maintenance';

interface AiUnitAssistantProps {
  tenantId: string;
  unitId?: string;
  buildingId?: string;
  type: AiUnitAssistantType;
  title?: string;
  description?: string;
  payload?: Record<string, any>;
  onSuggestion?: (data: any) => void;
  className?: string;
}

const ENDPOINT_MAP: Record<AiUnitAssistantType, string> = {
  suggestions: 'suggestions',
  pricing: 'price-optimization',
  'resident-risk': 'resident-risk',
  maintenance: 'maintenance-prediction',
};

const TYPE_CONFIG: Record<
  AiUnitAssistantType,
  {
    title: string;
    icon: any;
    color: string;
    description: string;
  }
> = {
  suggestions: {
    title: 'Unit Suggestions',
    icon: TrendingUp,
    color: 'bg-blue-50 border-blue-200',
    description: 'Optimal configuration for this unit',
  },
  pricing: {
    title: 'Price Optimization',
    icon: TrendingUp,
    color: 'bg-green-50 border-green-200',
    description: 'Market-competitive rental pricing',
  },
  'resident-risk': {
    title: 'Resident Risk Assessment',
    icon: AlertTriangle,
    color: 'bg-yellow-50 border-yellow-200',
    description: 'Evaluate potential risks for resident assignment',
  },
  maintenance: {
    title: 'Maintenance Predictions',
    icon: Wrench,
    color: 'bg-orange-50 border-orange-200',
    description: 'Predict maintenance needs',
  },
};

/**
 * Render JSON response in a readable format
 */
function JsonDisplay({ data }: { data: any }) {
  if (typeof data === 'string') {
    return <p className="text-sm whitespace-pre-wrap text-gray-700">{data}</p>;
  }

  // Handle structured JSON response
  if (typeof data === 'object' && data !== null) {
    return (
      <div className="space-y-2">
        {Object.entries(data).map(([key, value]) => {
          const displayKey = key
            .replace(/([A-Z])/g, ' $1')
            .replace(/_/g, ' ')
            .trim()
            .charAt(0)
            .toUpperCase() + key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim().slice(1);

          return (
            <div key={key} className="border-l-2 border-gray-300 pl-3">
              <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                {displayKey}
              </div>
              <div className="text-sm text-gray-700 mt-1">
                {Array.isArray(value) ? (
                  <ul className="list-disc list-inside space-y-1">
                    {value.map((item, i) => (
                      <li key={i}>
                        {typeof item === 'object' ? JSON.stringify(item) : String(item)}
                      </li>
                    ))}
                  </ul>
                ) : typeof value === 'object' ? (
                  <pre className="bg-gray-100 p-2 rounded text-xs overflow-auto">
                    {JSON.stringify(value, null, 2)}
                  </pre>
                ) : (
                  String(value)
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return <p className="text-sm text-gray-700">{String(data)}</p>;
}

/**
 * Main component
 */
export function AiUnitAssistant({
  tenantId,
  unitId,
  buildingId,
  type,
  title,
  description,
  payload = {},
  onSuggestion,
  className = '',
}: AiUnitAssistantProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<any>(null);

  const config = TYPE_CONFIG[type];
  const displayTitle = title || config.title;
  const displayDescription = description || config.description;
  const IconComponent = config.icon;

  // Determine endpoint and resource ID
  const resourceId = unitId || buildingId;

  // Fetch AI suggestion when expanded
  useEffect(() => {
    if (!isExpanded || !resourceId) return;

    const fetchSuggestion = async () => {
      setLoading(true);
      setError(null);
      setData(null);

      try {
        const endpoint = ENDPOINT_MAP[type];
        const url = `/api/tenants/${tenantId}/ai/units/${endpoint}/${resourceId}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.message || `Failed to get ${type} suggestions (${response.status})`,
          );
        }

        const result = await response.json();
        setData(result);

        // Call callback if provided
        if (onSuggestion) {
          onSuggestion(result);
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    fetchSuggestion();
  }, [isExpanded, tenantId, type, resourceId, payload, onSuggestion]);

  // Render error state if no resource ID
  if (!resourceId) {
    return (
      <div className={`p-4 bg-red-50 border border-red-200 rounded-lg ${className}`}>
        <div className="flex gap-2 items-start">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">
            Unit or Building ID is required for AI suggestions
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`border rounded-lg transition-all ${config.color} ${className}`}
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 flex gap-3 items-start hover:bg-white/50 transition-colors"
      >
        <IconComponent className="w-5 h-5 text-gray-700 mt-0.5 flex-shrink-0" />
        <div className="flex-1 text-left">
          <h3 className="font-semibold text-gray-900">{displayTitle}</h3>
          <p className="text-xs text-gray-600 mt-1">{displayDescription}</p>
        </div>
        <div className="text-gray-400">
          {loading ? (
            <Loader className="w-5 h-5 animate-spin" />
          ) : (
            <span>{isExpanded ? '▼' : '▶'}</span>
          )}
        </div>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="border-t p-4 space-y-3 bg-white/40">
          {error && (
            <div className="p-3 bg-red-100 border border-red-300 rounded text-sm text-red-700">
              <p className="font-medium">Error fetching suggestions:</p>
              <p className="text-xs mt-1">{error.message}</p>
            </div>
          )}

          {loading && (
            <div className="space-y-3">
              <div className="h-4 bg-gray-200 rounded w-3/4 animate-pulse"></div>
              <div className="h-4 bg-gray-200 rounded w-full animate-pulse"></div>
              <div className="h-4 bg-gray-200 rounded w-2/3 animate-pulse"></div>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-3">
              {/* Display answer if present */}
              {data.answer && (
                <div className="text-sm text-gray-700">
                  <p className="font-medium mb-2">Analysis:</p>
                  <p className="whitespace-pre-wrap">{data.answer}</p>
                </div>
              )}

              {/* Display structured JSON data if present */}
              {data.data && Object.keys(data.data).length > 0 && (
                <div>
                  <p className="font-medium text-sm mb-2">Details:</p>
                  <JsonDisplay data={data.data} />
                </div>
              )}

              {/* Fallback: display the whole response */}
              {!data.answer && data && (
                <JsonDisplay data={data} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
