import { request } from '../../api/client';

export type ActivityEvent = {
  id: string; actor_name: string; entity_type: 'client' | 'deal' | 'task' | 'invoice';
  entity_id: string; entity_label: string; action: string;
  changes: Record<string, { from: string | number | null; to: string | number | null } | string>;
  created_at: string;
};
export type ActivityPage = { count: number; next: string | null; previous: string | null; results: ActivityEvent[] };

export const activity = {
  list(page: number, entityType: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ page: String(page) });
    if (entityType) query.set('entity_type', entityType);
    return request<ActivityPage>(`/activity?${query}`, { signal });
  },
};
