import { request } from '../../api/client';

export type Task = {
  id: string; client: string; client_name: string; deal: string | null; deal_title: string | null;
  title: string; assignee: number | null; assignee_name: string | null; due_at: string;
  status: 'open' | 'done'; completed_at: string | null; created_by: number; created_at: string; updated_at: string;
};
export type TaskPage = { count: number; next: string | null; previous: string | null; results: Task[] };
export type TaskInput = { client: string; deal: string | null; title: string; assignee: number; due_at: string };
export type TaskFilters = { mine?: boolean; status?: 'open' | 'done'; due?: 'overdue' | 'upcoming'; search?: string; client?: string; deal?: string; page?: number; page_size?: number };

export const tasks = {
  list(filters: TaskFilters = {}, signal?: AbortSignal) {
    const query = new URLSearchParams();
    if (filters.mine) query.set('mine', '1');
    if (filters.status) query.set('status', filters.status);
    if (filters.due) query.set('due', filters.due);
    if (filters.search) query.set('search', filters.search);
    if (filters.client) query.set('client', filters.client);
    if (filters.deal) query.set('deal', filters.deal);
    query.set('page', String(filters.page ?? 1));
    query.set('page_size', String(filters.page_size ?? 20));
    return request<TaskPage>(`/tasks?${query}`, { signal });
  },
  create: (data: TaskInput) => request<Task>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Pick<Task, 'title' | 'assignee' | 'due_at' | 'status'>>) =>
    request<Task>(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
