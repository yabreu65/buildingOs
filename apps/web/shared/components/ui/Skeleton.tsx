'use client';

interface SkeletonProps {
  width?: string;
  height?: string;
  className?: string;
}

export default function Skeleton({
  width = '100%',
  height = '24px',
  className = '',
}: SkeletonProps) {
  return (
    <div
      style={{ width, height }}
      className={[
        'bg-muted rounded-md animate-pulse',
        className,
      ].join(' ')}
    />
  );
}
