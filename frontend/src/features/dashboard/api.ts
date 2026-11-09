import { request } from '../../api/client';

export type DashboardData = {
  currency: string;
  period: 'month' | 'quarter';
  start: string;
  end: string;
  pipeline_value: string | null;
  win_rate: string | null;
  average_deal_size: string | null;
  revenue: string | null;
  revenue_rows: { period: string; revenue: string | null }[];
  deal_counts: { status: string; count: number }[];
  recent_deals: { id: string; title: string; client__name: string; client__company: string; status: string; deadline: string | null; amount: string; currency: string }[];
  fx: {
    source: string;
    pipeline_rate_date: string | null;
    average_rate_dates: string[];
    revenue_rate_dates: string[];
    missing: { pipeline: string[]; average_deal_size: string[]; revenue: string[] };
  };
};

export const dashboard = {
  get: (currency: string, period: 'month' | 'quarter', signal?: AbortSignal) =>
    request<DashboardData>(`/analytics/dashboard?${new URLSearchParams({ currency, period })}`, { signal }),
};
