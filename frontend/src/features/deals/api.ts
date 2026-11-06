import { ApiError, request } from '../../api/client';
import type { Client, ClientPage } from '../clients/api';

export const stages = [
  { id: 'new_lead', label: 'New Lead', color: 'blue' },
  { id: 'negotiation', label: 'Negotiation', color: 'amber' },
  { id: 'in_progress', label: 'In Progress', color: 'purple' },
  { id: 'paid', label: 'Paid', color: 'green' },
  { id: 'archived', label: 'Archived', color: 'gray' },
] as const;
export type Status = typeof stages[number]['id'];
export type Outcome = 'none' | 'lost' | 'cancelled';
export type DealInput = { title: string; client: string; status: Status; amount: string; currency: string; deadline: string | null; outcome: Outcome };
export type Deal = DealInput & { id: string; version: number; paid_at: string | null; created_at: string; updated_at: string };
export type Total = { status: Status; currency: string; count: number; amount: string };
type DealPage = { count: number; results: Deal[]; next: string | null; totals: Total[] };
export type Filters = { search: string; status: string; currency: string };

export const deals = {
  async list(filters: Filters, signal?: AbortSignal) {
    const query = new URLSearchParams({ page_size: '100' });
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    const records = new Map<string, Deal>();
    let page = 1;
    let result: DealPage;
    let totals: Total[] = [];
    do {
      query.set('page', String(page++));
      result = await request<DealPage>(`/deals?${query}`, { signal });
      if (page === 2) totals = result.totals;
      result.results.forEach(deal => records.set(deal.id, deal));
    } while (result.next);
    return { results: [...records.values()], totals };
  },
  async clients(signal?: AbortSignal): Promise<Client[]> {
    const records = new Map<string, Client>();
    let page = 1;
    let result: ClientPage;
    do {
      result = await request<ClientPage>(`/clients?page_size=100&page=${page++}`, { signal });
      result.results.forEach(client => records.set(client.id, client));
    } while (result.next);
    return [...records.values()];
  },
  detail: (id: string, signal?: AbortSignal) => request<Deal>(`/deals/${encodeURIComponent(id)}`, { signal }),
  create: (values: DealInput) => request<Deal>('/deals', { method: 'POST', body: JSON.stringify(values) }),
  update: (deal: Deal, values: DealInput) => request<Deal>(`/deals/${encodeURIComponent(deal.id)}`, { method: 'PATCH', body: JSON.stringify({ ...values, version: deal.version }) }),
  status: (deal: Deal, status: Status, outcome: Outcome = 'none') => request<Deal>(`/deals/${encodeURIComponent(deal.id)}/status`, { method: 'PATCH', body: JSON.stringify({ status, outcome: status === 'archived' ? outcome : 'none', version: deal.version }) }),
  remove: (deal: Deal) => request<void>(`/deals/${encodeURIComponent(deal.id)}`, { method: 'DELETE', body: JSON.stringify({ version: deal.version }) }),
};

export const errorMessage = (cause: unknown) => cause instanceof ApiError && cause.status === 409
  ? 'This record was updated elsewhere. Reload to see the latest version.'
  : cause instanceof Error ? cause.message : 'Unable to complete the request. Please try again.';

export function money(amount: string, currency: string) {
  const [whole, fraction = '00'] = amount.split('.');
  const cents = fraction.padEnd(2, '0');
  return `${new Intl.NumberFormat('en-US').format(BigInt(whole))}${cents === '00' ? '' : `.${cents}`} ${currency}`;
}

export function date(value: string | null) {
  return value ? new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'No deadline';
}
