import type { TicketCategory } from './services/tickets.api';

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  MAINTENANCE: 'Mantenimiento',
  REPAIR: 'Reparación',
  CLEANING: 'Limpieza',
  COMPLAINT: 'Reclamo',
  SAFETY: 'Seguridad',
  BILLING: 'Facturación',
  OTHER: 'Otro',
};

export function ticketCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category as TicketCategory] ?? category;
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Abierto',
  IN_PROGRESS: 'En proceso',
  RESOLVED: 'Resuelto',
  CLOSED: 'Cerrado',
};

const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

export function ticketStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function ticketPriorityLabel(priority: string): string {
  return PRIORITY_LABELS[priority] ?? priority;
}
