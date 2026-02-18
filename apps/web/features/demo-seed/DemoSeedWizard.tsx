'use client';

import { useState, useEffect } from 'react';
import { Card, Button, useToast } from '@/shared/components/ui';
import { Zap, Check, AlertCircle } from 'lucide-react';
import * as api from './demo-seed.api';

interface DemoSeedWizardProps {
  tenantId: string;
  onSuccess?: () => void;
}

export function DemoSeedWizard({ tenantId, onSuccess }: DemoSeedWizardProps) {
  const [canGenerate, setCanGenerate] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [result, setResult] = useState<api.DemoSeedResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { toast } = useToast();

  // Check if can generate demo data on mount
  useEffect(() => {
    const checkStatus = async () => {
      setIsLoading(true);
      try {
        const response = await api.checkCanGenerateDemoData(tenantId);
        setCanGenerate(response.canGenerate);
        if (!response.canGenerate && response.reason) {
          setError(response.reason);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to check demo data status');
      } finally {
        setIsLoading(false);
      }
    };

    checkStatus();
  }, [tenantId]);

  const handleGenerateDemo = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const result = await api.generateDemoData(tenantId);
      setResult(result);
      setShowConfirm(false);
      toast('Demo data created successfully', 'success');

      if (onSuccess) {
        // Refresh page data after a short delay
        setTimeout(onSuccess, 1000);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate demo data';
      setError(message);
      toast(message, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="p-6 bg-blue-50 border-blue-200">
        <div className="flex items-center gap-3">
          <div className="animate-spin">
            <Zap size={20} className="text-blue-600" />
          </div>
          <p className="text-sm text-blue-900">Checking demo data status...</p>
        </div>
      </Card>
    );
  }

  // Already generated - show success
  if (result && result.success) {
    return (
      <Card className="p-6 bg-green-50 border-green-200">
        <div className="flex items-start gap-4">
          <Check size={24} className="text-green-600 flex-shrink-0 mt-1" />
          <div className="flex-1">
            <h3 className="font-semibold text-green-900 mb-2">Demo Data Created! 🎉</h3>
            <ul className="text-sm text-green-800 space-y-1">
              <li>✓ {result.summary.buildingsCreated} building created</li>
              <li>✓ {result.summary.unitsCreated} units created</li>
              <li>✓ {result.summary.ticketsCreated} tickets created</li>
              <li>✓ {result.summary.supportTicketsCreated} support tickets created</li>
              <li>✓ {result.summary.paymentsCreated} payments created</li>
              <li>✓ {result.summary.documentsCreated} documents created</li>
            </ul>
            <p className="text-xs text-green-700 mt-3">
              You can now explore all features with realistic sample data. Good luck! 🚀
            </p>
          </div>
        </div>
      </Card>
    );
  }

  // Cannot generate - show reason
  if (canGenerate === false) {
    return (
      <Card className="p-6 bg-yellow-50 border-yellow-200">
        <div className="flex items-start gap-4">
          <AlertCircle size={24} className="text-yellow-600 flex-shrink-0 mt-1" />
          <div className="flex-1">
            <h3 className="font-semibold text-yellow-900">Demo Data Not Available</h3>
            <p className="text-sm text-yellow-800 mt-1">{error}</p>
          </div>
        </div>
      </Card>
    );
  }

  // Confirmation dialog
  if (showConfirm) {
    return (
      <Card className="p-6 bg-blue-50 border-blue-200">
        <h3 className="font-semibold text-gray-900 mb-2">Generate Demo Data?</h3>
        <p className="text-sm text-gray-600 mb-4">
          This will create realistic sample data including:
          <ul className="list-disc list-inside mt-2 text-xs text-gray-600">
            <li>1 building with 5 units</li>
            <li>10 building maintenance tickets</li>
            <li>5 support requests</li>
            <li>Sample payments and documents</li>
          </ul>
        </p>
        <div className="flex gap-2">
          <Button
            onClick={handleGenerateDemo}
            variant="primary"
            disabled={isGenerating}
            size="sm"
          >
            {isGenerating ? 'Creating...' : 'Create Demo Data'}
          </Button>
          <Button
            onClick={() => setShowConfirm(false)}
            variant="secondary"
            disabled={isGenerating}
            size="sm"
          >
            Cancel
          </Button>
        </div>
      </Card>
    );
  }

  // Main view - can generate
  return (
    <Card className="p-6 bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Zap size={20} className="text-blue-600" />
            Explore with Demo Data
          </h3>
          <p className="text-sm text-gray-600 mt-2">
            Your account is in TRIAL mode. Generate realistic sample data to explore all features without manual setup.
          </p>
          <div className="mt-4 p-3 bg-white rounded border border-blue-100 text-xs text-gray-600">
            <strong>What you'll get:</strong> A complete building with units, tickets, support requests, payments, and documents—perfect for testing!
          </div>
        </div>
        <Button
          onClick={() => setShowConfirm(true)}
          variant="primary"
          className="flex-shrink-0"
          size="sm"
        >
          <Zap size={16} className="mr-2" />
          Create Demo Data
        </Button>
      </div>
      {error && (
        <div className="mt-4 p-3 bg-red-100 border border-red-300 rounded text-xs text-red-900">
          {error}
        </div>
      )}
    </Card>
  );
}
