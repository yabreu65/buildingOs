export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-muted text-muted-foreground border border-border',
  success:
    'bg-green-100 text-green-800 border border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900/60',
  warning:
    'bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/60',
  danger:
    'bg-red-100 text-red-800 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/60',
  info:
    'bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/60',
  muted: 'bg-muted text-muted-foreground border border-border',
};

interface BadgeProps {
  children: React.ReactNode;
  className?: string;
  variant?: BadgeVariant;
}

export default function Badge({
  children,
  className = '',
  variant,
}: BadgeProps) {
  const paletteClasses = variant
    ? variantClasses[variant]
    : className
      ? ''
      : variantClasses.default;
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${paletteClasses} ${className}`}
    >
      {children}
    </span>
  );
}
