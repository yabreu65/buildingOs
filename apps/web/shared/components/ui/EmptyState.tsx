'use client';

import { ReactNode } from 'react';
import Card from './Card';
import Button from './Button';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  cta?: {
    text: string;
    onClick: () => void;
  };
}

export default function EmptyState({
  icon,
  title,
  description,
  cta,
}: EmptyStateProps) {
  return (
    <div className="flex items-center justify-center min-h-[300px]">
      <Card className="w-full max-w-md">
        <div className="text-center">
          {icon && <div className="mb-4 flex justify-center">{icon}</div>}
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground mb-6">{description}</p>
          {cta && (
            <Button onClick={cta.onClick} variant="primary" size="sm">
              {cta.text}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
