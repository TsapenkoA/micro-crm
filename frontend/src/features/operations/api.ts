import { request } from '../../api/client';

export type DueItem = {
  kind: 'task' | 'deal' | 'invoice';
  id: string;
  title: string;
  subtitle: string;
  due_at: string;
  overdue: boolean;
};
type DueList = { count: number; results: DueItem[] };
export type OperationsOverview = {
  today: DueList;
  reminders: DueList;
  undated_invoices: { count: number; results: { id: string; invoice_number: string; client_name: string }[] };
};
export type InvoiceDeliveryAttempt = {
  id: string;
  invoice_id: string;
  invoice_number: string;
  workspace_name: string;
  kind: 'invoice' | 'reminder';
  result: 'pending' | 'unknown' | 'accepted' | 'failed';
  recipient: string;
  attempted_at: string;
};
type InvoiceDeliveryPage = {
  count: number;
  next: string | null;
  previous: string | null;
  results: InvoiceDeliveryAttempt[];
};

export const operations = {
  overview: (signal?: AbortSignal, page = 1, undatedPage = 1) =>
    request<OperationsOverview>(
      `/operations/overview?${new URLSearchParams({ page: String(page), undated_page: String(undatedPage) })}`,
      { signal },
    ),
  pendingDeliveries: (signal?: AbortSignal, page = 1) =>
    request<InvoiceDeliveryPage>(`/operations/invoice-deliveries?page=${page}`, { signal }),
  resolveDelivery: (id: string, outcome: 'accepted' | 'failed', reason: string) =>
    request<InvoiceDeliveryAttempt>(`/operations/invoice-deliveries/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ outcome, reason }),
    }),
};
