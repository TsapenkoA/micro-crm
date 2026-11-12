import { ApiError, request, type BankDetails } from '../../api/client';

export type InvoiceItemInput = { description: string; quantity: string; unit_price: string; tax_rate: string };
export const currencyPlaces = { USD: 2, EUR: 2, GBP: 2, PLN: 2, AUD: 2, CAD: 2, CHF: 2, JPY: 0 } as const;
export const invoiceCurrencies = ['USD', 'EUR', 'GBP', 'PLN', ...Object.keys(currencyPlaces).filter(currency => !['USD', 'EUR', 'GBP', 'PLN'].includes(currency)).sort()];
export type InvoiceInput = { client: string; deal: string | null; currency: string; due_date: string | null; payment_terms: string; seller?: { name: string; email: string; phone: string; address: string; tax_id: string }; items: InvoiceItemInput[] };
export type InvoiceItem = InvoiceItemInput & { id: number; position: number; line_total: string; tax_amount: string };
export type InvoicePayment = { id: string; amount: string; received_on: string; reference: string; is_legacy: boolean; created_at: string };
export type InvoiceDelivery = { id: string; kind: 'invoice' | 'reminder'; result: 'accepted' | 'failed'; recipient: string; attempted_at: string };
export type Invoice = {
  id: string; invoice_number: string; client: string; deal: string | null; currency: string; status: 'draft' | 'sent' | 'paid' | 'cancelled';
  seller_snapshot: { name?: string; email?: string; phone?: string; address?: string; tax_id?: string; bank_details?: BankDetails };
  buyer_snapshot: { name?: string; company?: string; email?: string; phone?: string; bank_details?: BankDetails };
  items: InvoiceItem[]; subtotal: string; tax_total: string; total_amount: string;
  payments: InvoicePayment[]; paid_amount: string; balance_due: string; overdue: boolean; deliveries: InvoiceDelivery[];
  issued_at: string | null; due_date: string | null; payment_terms: string; paid_at: string | null;
  cancelled_at: string | null; cancellation_reason: string; created_at: string;
};
export type ReminderPreview = { subject: string; body: string; can_send: boolean; reason: string };
type InvoicePage = { count: number; results: Invoice[]; next: string | null };

export const invoices = {
  async list(search = '', status = '', signal?: AbortSignal, deal = '') {
    const rows: Invoice[] = [];
    let page = 1;
    let next: string | null;
    do {
      const query = new URLSearchParams({ page_size: '100', page: String(page++) });
      if (search) query.set('search', search);
      if (status === 'overdue') query.set('overdue', 'true');
      else if (status) query.set('status', status);
      if (deal) query.set('deal', deal);
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
  payment: (id: string, amount: string, received_on: string, reference: string) => request<Invoice>(`/invoices/${encodeURIComponent(id)}/payments`, { method: 'POST', body: JSON.stringify({ amount, received_on, reference }) }),
  cancel: (id: string, reason: string) => request<Invoice>(`/invoices/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  send: (id: string) => request<Invoice>(`/invoices/${encodeURIComponent(id)}/send`, { method: 'POST', body: '{}' }),
  reminderPreview: (id: string) => request<ReminderPreview>(`/invoices/${encodeURIComponent(id)}/reminder`),
  remind: (id: string) => request<Invoice>(`/invoices/${encodeURIComponent(id)}/reminder`, { method: 'POST', body: '{}' }),
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
