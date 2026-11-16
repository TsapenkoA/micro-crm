import { useEffect, useState } from 'react';
import { clients, type ClientInvoice, type HistoryPage } from './api';
import { money } from '../invoices/api';

export default function ClientInvoices({ clientId }: { clientId: string }) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<HistoryPage<ClientInvoice> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { setPage(1); }, [clientId]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    clients.invoices(clientId, page, controller.signal)
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setError('Unable to load client invoices.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [clientId, page, revision]);

  return <section aria-label="Client invoices"><div className="history-heading"><h3>Invoices {data && <span className="client-deal-count">{data.count}</span>}</h3><button className="text-action" onClick={() => setRevision(value => value + 1)}>Refresh invoices</button></div>
    {loading ? <p role="status" className="muted">Loading invoices…</p> : error ? <p role="alert" className="notice error">{error}</p> : data?.results.length ? <><ul className="deal-list">{data.results.map(invoice => <li key={invoice.id} className="client-related-deal"><a href={`#/invoices?invoice=${encodeURIComponent(invoice.id)}`}>{invoice.invoice_number}</a><span>{invoice.overdue ? 'Overdue' : invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}</span><p className="muted">{money(invoice.total_amount, invoice.currency)} · {invoice.due_date ? `Due ${new Date(`${invoice.due_date}T00:00:00`).toLocaleDateString('en-US', { dateStyle: 'medium' })}` : 'No due date'}</p></li>)}</ul><div className="history-pagination"><span className="muted">Page {page}</span><div className="button-row"><button className="secondary" disabled={!data.previous} onClick={() => setPage(value => value - 1)}>Previous</button><button className="secondary" disabled={!data.next} onClick={() => setPage(value => value + 1)}>Next</button></div></div></> : <p className="muted">No invoices for this client.</p>}
  </section>;
}
