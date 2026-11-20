import InvoiceStatus from '../invoices/InvoiceStatus';
import { useEffect, useState, type ReactNode } from 'react';
import { clients, type ClientAttachment, type ClientDetail, type ClientInvoice, type ClientLink, type ClientNote, type HistoryPage } from './api';
import { tasks, type TaskPage } from '../tasks/api';
import { date, money } from '../deals/api';
import ClientSectionIcon from './ClientSectionIcon';

type ClientPreview = {
  invoices: HistoryPage<ClientInvoice>;
  tasks: TaskPage;
  notes: HistoryPage<ClientNote>;
  links: HistoryPage<ClientLink>;
  files: HistoryPage<ClientAttachment>;
};
const initials = (value: string) => value.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();

type Section = 'deals' | 'invoices' | 'contacts' | 'tasks' | 'notes' | 'links' | 'files';

export function useClientPreview(clientId: string, revision = 0) {
  const [preview, setPreview] = useState<Partial<ClientPreview>>({});
  const [failed, setFailed] = useState<Section[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    setFailed([]);
    const requests = {
      invoices: clients.invoices(clientId, 1, controller.signal),
      tasks: tasks.list({ client: clientId, page_size: 2 }, controller.signal),
      notes: clients.notes(clientId, 1, controller.signal),
      links: clients.links(clientId, 1, controller.signal),
      files: clients.attachments(clientId, 1, controller.signal),
    };
    (Object.keys(requests) as (keyof ClientPreview)[]).forEach(key => {
      requests[key].then(data => {
        if (!controller.signal.aborted) setPreview(current => ({ ...current, [key]: data }));
      }).catch(() => {
        if (!controller.signal.aborted) setFailed(current => [...current, key]);
      });
    });
    return () => controller.abort();
  }, [clientId, revision]);

  return { preview, failed };
}

export default function ClientOverview({ client, preview, failed, onSelect }: { client: ClientDetail; preview: Partial<ClientPreview>; failed: Section[]; onSelect: (section: Section) => void }) {
  const card = (section: Section, count: number | undefined, content: ReactNode) => <section className={`client-overview-card client-overview-${section}`} aria-label={`${section} preview`}>
    <div className="client-overview-heading"><h3><button className="client-overview-title" onClick={() => onSelect(section)} aria-label={`Open ${section}`}><ClientSectionIcon name={section} />{section[0].toUpperCase() + section.slice(1)} {count !== undefined && <span className="client-deal-count">{count}</span>}</button></h3></div>
    {content}
  </section>;
  const pending = (section: Section) => <p className="muted">{failed.includes(section) ? 'Preview unavailable.' : 'Loading…'}</p>;

  return <div className="client-detail-overview">
    {card('deals', client.deals.length, client.deals.length ? <ul>{client.deals.slice(0, 2).map(deal => <li key={deal.id} className="client-overview-item"><a href={`#/deals?deal=${encodeURIComponent(deal.id)}`}>{deal.title}</a><small className="muted">{money(deal.amount, deal.currency)} · {deal.deadline ? date(deal.deadline) : 'No deadline'}</small></li>)}</ul> : <p className="muted">No related deals.</p>)}
    {card('invoices', preview.invoices?.count, preview.invoices ? preview.invoices.results.length ? <ul>{preview.invoices.results.slice(0, 2).map(invoice => <li key={invoice.id} className="client-overview-item"><a href={`#/invoices?invoice=${encodeURIComponent(invoice.id)}`}>{invoice.invoice_number}</a><small className="muted">{money(invoice.total_amount, invoice.currency)} · {invoice.status[0].toUpperCase() + invoice.status.slice(1)}</small><span className="client-preview-status"><InvoiceStatus status={invoice.status} overdue={invoice.overdue} /></span></li>)}</ul> : <p className="muted">No invoices.</p> : pending('invoices'))}
    {card('contacts', client.contacts.length, client.contacts.length ? <ul>{client.contacts.slice(0, 2).map(contact => <li key={contact.id} className="client-overview-item"><span className="client-contact-avatar" aria-hidden="true">{initials(contact.name)}</span><strong>{contact.name}</strong><small className="muted">{contact.role || contact.email || contact.phone || 'Contact'}</small></li>)}</ul> : <p className="muted">No contacts.</p>)}
    {card('tasks', preview.tasks?.count, preview.tasks ? preview.tasks.results.length ? <ul>{preview.tasks.results.slice(0, 2).map(task => <li key={task.id} className="client-overview-item"><a href={`#/tasks?task=${encodeURIComponent(task.id)}`}>{task.title}</a><small className="muted">{task.status === 'done' ? 'Done' : 'Open'}</small></li>)}</ul> : <p className="muted">No related tasks.</p> : pending('tasks'))}
    {card('notes', preview.notes?.count, preview.notes ? preview.notes.results.length ? <ul>{preview.notes.results.slice(0, 1).map(note => <li key={note.id} className="client-overview-item"><strong>{note.author.username}</strong><small className="client-overview-note">{note.text}</small></li>)}</ul> : <p className="muted">No notes.</p> : pending('notes'))}
    {card('links', preview.links?.count, preview.links ? preview.links.results.length ? <ul>{preview.links.results.slice(0, 1).map(link => <li key={link.id} className="client-overview-item"><strong>{link.label}</strong><small className="muted">{link.url}</small><a className="client-preview-action" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${link.label}`}><ClientSectionIcon name="external" /></a></li>)}</ul> : <p className="muted">No links.</p> : pending('links'))}
    {card('files', preview.files?.count, preview.files ? preview.files.results.length ? <ul>{preview.files.results.slice(0, 1).map(file => <li key={file.id} className="client-overview-item"><strong>{file.name}</strong><small className="muted">{Math.ceil(file.size / 1024)} KB</small><a className="client-preview-action" href={`/api/v1/clients/${encodeURIComponent(client.id)}/attachments/${encodeURIComponent(file.id)}`} download={file.name} aria-label={`Download ${file.name}`}><ClientSectionIcon name="download" /></a></li>)}</ul> : <p className="muted">No files.</p> : pending('files'))}
  </div>;
}
