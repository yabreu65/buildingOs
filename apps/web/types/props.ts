/**
 * Reusable component props interfaces
 * Extend these to reduce prop interface boilerplate
 */
import { ReactNode } from 'react';

// ============================================================================
// Base Props
// ============================================================================

export interface BaseComponentProps {
  className?: string;
  id?: string;
  'data-testid'?: string;
}

// ============================================================================
// Form Component Props
// ============================================================================

export interface FormComponentProps extends BaseComponentProps {
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  helperText?: string;
  size?: 'sm' | 'md' | 'lg';
}

export interface InputProps extends FormComponentProps {
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url';
  value?: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  autoComplete?: string;
  maxLength?: number;
}

export interface SelectProps<T = string> extends FormComponentProps {
  value?: T;
  onChange?: (value: T) => void;
  onBlur?: () => void;
  options: readonly {
    label: string;
    value: T;
    disabled?: boolean;
  }[];
  isMulti?: boolean;
  isClearable?: boolean;
  isSearchable?: boolean;
}

export interface CheckboxProps extends BaseComponentProps {
  label?: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  error?: string;
  required?: boolean;
}

export interface RadioGroupProps<T = string> extends BaseComponentProps {
  label?: string;
  value?: T;
  onChange?: (value: T) => void;
  options: readonly {
    label: string;
    value: T;
    disabled?: boolean;
  }[];
  disabled?: boolean;
  error?: string;
  required?: boolean;
}

export interface TextAreaProps extends FormComponentProps {
  value?: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  rows?: number;
  maxLength?: number;
}

export interface FormProps extends BaseComponentProps {
  children: ReactNode;
  onSubmit: (e: React.FormEvent) => void;
  isLoading?: boolean;
}

// ============================================================================
// Modal & Dialog Props
// ============================================================================

export interface ModalProps extends BaseComponentProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  loading?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeButton?: boolean;
}

export interface DialogProps extends ModalProps {
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
}

// ============================================================================
// List & Table Props
// ============================================================================

export interface ListItemProps<T = unknown> extends BaseComponentProps {
  item: T;
  onSelect?: (item: T) => void;
  onDelete?: (id: string) => void;
  onEdit?: (item: T) => void;
  isSelected?: boolean;
  isLoading?: boolean;
  isDisabled?: boolean;
}

export interface ListProps<T = unknown> extends BaseComponentProps {
  items: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  onSelectItem?: (item: T) => void;
  isLoading?: boolean;
  isEmpty?: boolean;
  emptyMessage?: string;
  keyExtractor?: (item: T, index: number) => string;
}

export interface TableColumnDef<T = unknown> {
  readonly key: string;
  readonly label: string;
  readonly render?: (value: unknown, item: T) => ReactNode;
  readonly width?: string | number;
  readonly sortable?: boolean;
  readonly filterable?: boolean;
}

export interface TableProps<T = unknown> extends BaseComponentProps {
  columns: readonly TableColumnDef<T>[];
  data: readonly T[];
  onRowClick?: (item: T) => void;
  isLoading?: boolean;
  isPaginated?: boolean;
  currentPage?: number;
  pageSize?: number;
  totalItems?: number;
  onPageChange?: (page: number) => void;
  onSort?: (column: string, direction: 'asc' | 'desc') => void;
  rowKey?: (item: T) => string;
}

// ============================================================================
// Card & Container Props
// ============================================================================

export interface CardProps extends BaseComponentProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  onClick?: () => void;
  onClose?: () => void;
  loading?: boolean;
  variant?: 'default' | 'elevated' | 'outlined' | 'filled';
  size?: 'sm' | 'md' | 'lg';
  actions?: ReactNode;
}

export interface ContainerProps extends BaseComponentProps {
  children: ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

// ============================================================================
// Badge & Status Props
// ============================================================================

export interface BadgeProps extends BaseComponentProps {
  children: ReactNode;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info';
  size?: 'sm' | 'md' | 'lg';
}

export interface StatusProps extends BaseComponentProps {
  status: 'success' | 'error' | 'warning' | 'info' | 'pending';
  message: string;
  icon?: ReactNode;
  onDismiss?: () => void;
}

// ============================================================================
// Button & Action Props
// ============================================================================

export interface ButtonProps extends BaseComponentProps {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
}

export interface ActionButtonProps extends ButtonProps {
  action: 'create' | 'edit' | 'delete' | 'view' | 'download' | 'upload';
  isConfirming?: boolean;
}

// ============================================================================
// Async State & Loading Props
// ============================================================================

export interface AsyncState<T = unknown> {
  data: T | null;
  loading: boolean;
  error: string | null;
  isIdle?: boolean;
}

export interface LoadingStateProps extends BaseComponentProps {
  isLoading: boolean;
  children: ReactNode;
  fallback?: ReactNode;
}

export interface ErrorStateProps extends BaseComponentProps {
  error: string | null;
  children: ReactNode;
  onRetry?: () => void;
  fallback?: ReactNode;
}

export interface EmptyStateProps extends BaseComponentProps {
  isEmpty: boolean;
  children: ReactNode;
  message?: string;
  action?: ReactNode;
  fallback?: ReactNode;
}

// ============================================================================
// Pagination Props
// ============================================================================

export interface PaginationProps extends BaseComponentProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  maxPagesDisplayed?: number;
}

// ============================================================================
// Search & Filter Props
// ============================================================================

export interface SearchProps extends BaseComponentProps {
  value: string;
  onChange: (value: string) => void;
  onSearch?: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  disabled?: boolean;
}

export interface FilterProps<T = Record<string, unknown>> extends BaseComponentProps {
  filters: T;
  onFiltersChange: (filters: T) => void;
  onReset?: () => void;
  children: ReactNode;
}

// ============================================================================
// Menu & Dropdown Props
// ============================================================================

export interface MenuItemDef<T = unknown> {
  readonly label: string;
  readonly value: T;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly isDangerous?: boolean;
}

export interface MenuProps<T = unknown> extends BaseComponentProps {
  items: readonly MenuItemDef<T>[];
  onSelect: (value: T) => void;
  trigger?: ReactNode;
  placement?: 'top' | 'right' | 'bottom' | 'left';
}

// ============================================================================
// Notification Props
// ============================================================================

export interface ToastProps extends BaseComponentProps {
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
  onClose?: () => void;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface NotificationProps extends BaseComponentProps {
  title?: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  onClose?: () => void;
  action?: ReactNode;
}
