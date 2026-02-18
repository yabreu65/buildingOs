/**
 * Unified inbox types (mirror of backend)
 */

export type TicketSummary = {
  id: string;
  buildingId: string;
  buildingName: string;
  unitCode?: string | null;
  title: string;
  priority: string;
  status: string;
  assignedTo?: string | null;
  createdAt: string;
};

export type PaymentSummary = {
  id: string;
  buildingId: string;
  buildingName: string;
  unitCode?: string | null;
  amount: number;
  method: string;
  status: string;
  createdAt: string;
  proofFileId?: string | null;
};

export type CommunicationSummary = {
  id: string;
  buildingId?: string | null;
  buildingName?: string | null;
  title: string;
  status: string;
  channel: string;
  scheduledAt?: string | null;
  createdAt: string;
};

export type DelinquentUnit = {
  buildingId: string;
  buildingName: string;
  unitId: string;
  unitCode: string;
  outstanding: number;
};

export type AlertSummary = {
  urgentUnassignedTicketsCount: number;
  delinquentUnitsTop: DelinquentUnit[];
};

export type InboxSummaryResponse = {
  tickets: TicketSummary[];
  payments: PaymentSummary[];
  communications: CommunicationSummary[];
  alerts: AlertSummary;
};
