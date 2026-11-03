import { request } from '../../api/client';

export type ClientInput = { name: string; company: string; email: string; phone: string };
export type Client = ClientInput & {
  id: string;
  workspace: string;
  created_by: number;
  created_at: string;
  updated_at: string;
};
export type ClientDeal = {
  id: string;
  title: string;
  status: string;
  amount: string;
  currency: string;
  deadline: string | null;
};
export type ClientDetail = Client & { deals: ClientDeal[] };
export type ClientPage = { count: number; next: string | null; previous: string | null; results: Client[] };

export const clients = {
  list(search: string, page: number, signal?: AbortSignal) {
    const query = new URLSearchParams({ page: String(page) });
    if (search) query.set('search', search);
    return request<ClientPage>(`/clients?${query}`, { signal });
  },
  detail: (id: string, signal?: AbortSignal) => request<ClientDetail>(`/clients/${encodeURIComponent(id)}`, { signal }),
  create: (data: ClientInput) => request<Client>('/clients', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: ClientInput) => request<Client>(`/clients/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/clients/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
