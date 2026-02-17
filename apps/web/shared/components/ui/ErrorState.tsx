'use client';

import { AlertCircle } from 'lucide-react';
import Card from './Card';
import Button from './Button';

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  isRetrying?: boolean;
}

export default function ErrorState({
  message,
  onRetry,
  isRetrying = false,
}: ErrorStateProps) {
  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <Card className="w-full max-w-md border-red-200 bg-red-50">
        <div className="text-center">
          <div className="mb-4 flex justify-center">
            <AlertCircle className="text-red-600" size={32} />
          </div>
          <h3 className="text-lg font-semibold text-red-900 mb-2">
            Something went wrong
          </h3>
          <p className="text-sm text-red-700 mb-6">{message}</p>
          {onRetry && (
            <Button
              onClick={onRetry}
              disabled={isRetrying}
              size="sm"
            >
              {isRetrying ? 'Retrying...' : 'Try Again'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
