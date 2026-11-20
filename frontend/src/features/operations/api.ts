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
export type OperationsOverview = { today: DueList; reminders: DueList; undated_invoices: { count: number; results: { id: string; invoice_number: string; client_name: string }[] } };

export const operations = {
  overview: (signal?: AbortSignal, page = 1, undatedPage = 1) => request<OperationsOverview>(`/operations/overview?${new URLSearchParams({ page: String(page), undated_page: String(undatedPage) })}`, { signal }),
};
