/**
 * Simple utility function to conditionally concatenate class names
 * Similar to clsx or classnames
 */
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
