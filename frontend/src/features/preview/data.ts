export const stages = [
  { id: 'new_lead', label: 'New Lead', color: 'blue' },
  { id: 'negotiation', label: 'Negotiation', color: 'amber' },
  { id: 'in_progress', label: 'In Progress', color: 'purple' },
  { id: 'paid', label: 'Paid', color: 'green' },
  { id: 'archived', label: 'Archived', color: 'gray' },
] as const;
export type Stage = typeof stages[number]['id'];
export type PreviewClient = { id: string; name: string; company: string; email: string; phone: string; initials: string; color: string };
export type PreviewDeal = { id: string; title: string; client: string; amount: number; currency: string; status: Stage; deadline: string; category: string; outcome?: 'lost' | 'cancelled' };
export type PreviewInvoice = { id: string; client: string; description: string; amount: number; status: 'draft' | 'sent' | 'paid'; date: string };
export type PreviewContent = { dealNextStep: string; dealNote: string; dealNoteTime: string; clientNote: string; clientNoteTime: string; linkLabel: string; invoiceFromDescription: string };
export type PreviewData = { clients: PreviewClient[]; deals: PreviewDeal[]; invoices: PreviewInvoice[]; profile: { name: string; username: string; email: string; avatar: string }; workspaceName: string; content: PreviewContent };

export const money = (value: number, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
export const shortDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
