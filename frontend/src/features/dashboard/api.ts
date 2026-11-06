import { request } from '../../api/client';

export type DashboardData = {
  currency: string;
  period: 'month' | 'quarter';
  start: string;
  end: string;
  pipeline_value: string;
  win_rate: string | null;
  average_deal_size: string | null;
  revenue: string;
  revenue_rows: { period: string; revenue: string }[];
  deal_counts: { status: string; count: number }[];
  recent_deals: { id: string; title: string; client__name: string; client__company: string; status: string; deadline: string | null; amount: string }[];
};

export const dashboard = {
  get: (currency: string, period: 'month' | 'quarter', signal?: AbortSignal) =>
    request<DashboardData>(`/analytics/dashboard?${new URLSearchParams({ currency, period })}`, { signal }),
};
