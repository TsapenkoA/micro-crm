import { ApiError, request } from '../../api/client';

export type InvoiceItemInput = { description: string; quantity: string; unit_price: string; tax_rate: string };
export type InvoiceInput = { client: string; currency: 'USD' | 'EUR'; seller: { name: string; email: string; address: string; tax_id: string }; items: InvoiceItemInput[] };
export type InvoiceItem = InvoiceItemInput & { id: number; position: number; line_total: string; tax_amount: string };
export type Invoice = {
  id: string; invoice_number: string; client: string; currency: string; status: 'draft' | 'sent' | 'paid';
  seller_snapshot: { name?: string; email?: string; address?: string; tax_id?: string };
  buyer_snapshot: { name?: string; company?: string; email?: string; phone?: string };
  items: InvoiceItem[]; subtotal: string; tax_total: string; total_amount: string;
  issued_at: string | null; paid_at: string | null; created_at: string;
};
type InvoicePage = { count: number; results: Invoice[]; next: string | null };

export const invoices = {
  async list(search = '', status = '', signal?: AbortSignal) {
    const rows: Invoice[] = [];
    let page = 1;
    let next: string | null;
    do {
      const query = new URLSearchParams({ page_size: '100', page: String(page++) });
      if (search) query.set('search', search);
      if (status) query.set('status', status);
      const result: InvoicePage = await request(`/invoices?${query}`, { signal });
      rows.push(...result.results);
      next = result.next;
    } while (next);
    return rows;
  },
  detail: (id: string) => request<Invoice>(`/invoices/${encodeURIComponent(id)}`),
  create: (data: InvoiceInput) => request<Invoice>('/invoices', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: InvoiceInput) => request<Invoice>(`/invoices/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }),
  status: (id: string, status: 'sent' | 'paid') => request<Invoice>(`/invoices/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  async pdf(id: string) {
    let response: Response;
    try { response = await fetch(`/api/v1/invoices/${encodeURIComponent(id)}/pdf`, { credentials: 'same-origin' }); }
    catch { throw new Error('Unable to reach the server. Try again.'); }
    if (!response.ok) throw new ApiError(response.status, 'Unable to generate the invoice PDF. Try again.');
    if (!response.headers.get('content-type')?.includes('application/pdf')) throw new Error('The server returned an invalid PDF.');
    return response.blob();
  },
};

export function money(value: string, currency: string) {
  const [whole, fraction = ''] = value.split('.');
  return `${new Intl.NumberFormat('en-US').format(BigInt(whole))}${fraction && !/^0+$/.test(fraction) ? `.${fraction}` : ''} ${currency}`;
}
