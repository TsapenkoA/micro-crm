import { request } from '../../api/client';

export type DueItem = {
  kind: 'task' | 'deal' | 'invoice';
  id: string;
  title: string;
  subtitle: string;
  due_at: string;
  overdue: boolean;
};
export type DueList = { count: number; results: DueItem[] };
export type OperationsOverview = { today: DueList; reminders: DueList };

export const operations = {
  overview: (signal?: AbortSignal) => request<OperationsOverview>('/operations/overview', { signal }),
};
