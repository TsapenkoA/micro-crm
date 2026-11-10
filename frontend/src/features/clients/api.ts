import { request, type BankDetails } from '../../api/client';

export type ClientInput = { name: string; company: string; email: string; phone: string; bank_details?: BankDetails };
export type Client = ClientInput & {
  id: string;
  workspace: string;
  created_by: number;
  created_at: string;
  updated_at: string;
  deal_count?: number;
};
export type ClientDeal = {
  id: string;
  title: string;
  status: string;
  amount: string;
  currency: string;
  deadline: string | null;
};
export type ClientDetail = Client & { deals: ClientDeal[]; bank_details?: BankDetails };
export type ClientPage = { count: number; next: string | null; previous: string | null; results: Client[] };
export type ClientNote = { id: string; client: string; author: { id: number; username: string }; text: string; created_at: string; can_delete: boolean };
export type ClientLink = { id: string; client: string; label: string; url: string; created_at: string };
export type HistoryPage<T> = { count: number; next: string | null; previous: string | null; results: T[] };

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
  notes: (id: string, page: number, signal?: AbortSignal) => request<HistoryPage<ClientNote>>(`/clients/${encodeURIComponent(id)}/notes?page=${page}&page_size=20`, { signal }),
  addNote: (id: string, text: string) => request<ClientNote>(`/clients/${encodeURIComponent(id)}/notes`, { method: 'POST', body: JSON.stringify({ text }) }),
  removeNote: (id: string, noteId: string) => request<void>(`/clients/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' }),
  links: (id: string, page: number, signal?: AbortSignal) => request<HistoryPage<ClientLink>>(`/clients/${encodeURIComponent(id)}/links?page=${page}&page_size=20`, { signal }),
  addLink: (id: string, label: string, url: string) => request<ClientLink>(`/clients/${encodeURIComponent(id)}/links`, { method: 'POST', body: JSON.stringify({ label, url }) }),
};
