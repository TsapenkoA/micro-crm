import { useEffect, useState, type FormEvent } from 'react';
import Dialog from '../../components/Dialog';
import type { Client } from '../clients/api';
import { deals } from '../deals/api';
import InvoiceForm from './InvoiceForm';
import { currencyPlaces, invoiceCurrencies, invoices, money, type Invoice, type InvoiceInput } from './api';
import './invoices.css';

function summaryAmount(records: Invoice[], status: Invoice['status'], currency: string) {
  const places = currencyPlaces[currency as keyof typeof currencyPlaces];
  const unit = 10n ** BigInt(places);
  const total = records.filter(invoice => invoice.status === status && invoice.currency === currency).reduce((sum, invoice) => {
    const [whole, fraction = ''] = invoice.total_amount.split('.');
    return sum + BigInt(whole) * unit + BigInt(fraction.padEnd(places, '0').slice(0, places) || '0');
  }, 0n);
  const value = places ? `${total / unit}.${String(total % unit).padStart(places, '0')}` : String(total);
  const formatted = money(value, currency);
  return currency === 'USD' || currency === 'EUR' ? `${currency === 'USD' ? '$' : '€'}${formatted.replace(` ${currency}`, '')}` : formatted;
}

export default function InvoicesPage({ createRequested = false, onCreateHandled, onCountChanged, workspaceName, userEmail }: {
  createRequested?: boolean; onCreateHandled?: () => void; onCountChanged?: () => void; workspaceName: string; userEmail: string;
}) {
  const [records, setRecords] = useState<Invoice[]>([]);
  const [allRecords, setAllRecords] = useState<Invoice[]>([]);
  const [summaryCurrency, setSummaryCurrency] = useState('USD');
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');
  const [editor, setEditor] = useState<Invoice | 'new' | null>(null);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const visibleRecords = records.filter(invoice => invoice.currency === summaryCurrency);

  useEffect(() => { if (createRequested && !loading) { setEditor('new'); onCreateHandled?.(); } }, [createRequested, loading, onCreateHandled]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const list = invoices.list(search, status, controller.signal);
    const summary = search || status ? invoices.list('', '', controller.signal) : list;
    Promise.all([list, summary, deals.clients(controller.signal)])
      .then(([rows, totals, options]) => { if (!controller.signal.aborted) { setRecords(rows); setAllRecords(totals); setClients(options); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load invoices.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [search, status, revision]);

  function refresh() { setRevision(value => value + 1); }
  function submitSearch(event: FormEvent) { event.preventDefault(); setSearch(draft.trim()); }
  async function save(values: InvoiceInput) {
    const saved = editor === 'new' ? await invoices.create(values) : await invoices.update((editor as Invoice).id, values);
    setEditor(null); setSelected(saved); setMessage(editor === 'new' ? 'Invoice created.' : 'Draft updated.'); refresh(); onCountChanged?.();
  }
  async function transition(next: 'sent' | 'paid') {
    if (!selected || pending) return;
    setPending(true); setActionError('');
    try { const updated = await invoices.status(selected.id, next); setSelected(updated); setMessage(next === 'sent' ? 'Invoice marked as sent.' : 'Invoice marked as paid.'); refresh(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Unable to update the invoice.'); }
    finally { setPending(false); }
  }
  async function pdf(print = false) {
    if (!selected || pending) return;
    setPending(true); setActionError('');
    try {
      const blob = await invoices.pdf(selected.id);
      const url = URL.createObjectURL(blob);
      if (print) {
        const frame = document.createElement('iframe');
        frame.style.display = 'none'; frame.src = url; frame.title = 'Invoice print document';
        frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60000); };
        document.body.append(frame);
      } else {
        const link = document.createElement('a'); link.href = url; link.download = `${selected.invoice_number}.pdf`; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Unable to prepare the PDF.'); }
    finally { setPending(false); }
  }

  return <section className="invoices-page" aria-label="Company invoices">
    {message && <p role="status" className="notice success">{message}</p>}
    <div className="invoice-summary-heading"><p className="muted">Showing invoices and totals in the selected currency.</p><label><span className="sr-only">Summary currency</span><select aria-label="Summary currency" value={summaryCurrency} onChange={event => setSummaryCurrency(event.target.value)}>{invoiceCurrencies.map(currency => <option key={currency}>{currency}</option>)}</select></label></div>
    <div className="invoice-summary">{(['sent', 'paid', 'draft'] as const).map(item => <article className="panel" key={item}><span className={`invoice-summary-label invoice-summary-${item}`}><i aria-hidden="true" />{item === 'sent' ? 'Outstanding' : item === 'paid' ? 'Paid' : 'Drafts'}</span><strong>{summaryAmount(allRecords, item, summaryCurrency)}</strong><small>{summaryCurrency} · {allRecords.filter(invoice => invoice.status === item && invoice.currency === summaryCurrency).length} {item === 'draft' ? 'draft invoices' : item === 'sent' ? 'sent invoices' : 'paid invoices'}</small></article>)}</div>
    <div className="panel invoice-list"><div className="invoice-toolbar"><div className="invoice-status-filters" role="group" aria-label="Invoice status">{(['', 'draft', 'sent', 'paid'] as const).map(item => <button key={item} aria-pressed={status === item} onClick={() => setStatus(item)}>{item ? item[0].toUpperCase() + item.slice(1) : 'All invoices'}</button>)}</div><form onSubmit={submitSearch}><input aria-label="Search invoices" placeholder="Search number or client" value={draft} onChange={event => setDraft(event.target.value)} /><button className="secondary">Search</button></form><button className="secondary" onClick={refresh}>Refresh</button></div>
      {error && <p role="alert" className="notice error">{error} <button className="secondary" onClick={refresh}>Retry</button></p>}
      {loading ? <p role="status" className="invoice-list-state">Loading invoices…</p> : visibleRecords.length ? <div className="invoice-table-wrap"><table><thead><tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Status</th><th>Total</th><th>Preview</th></tr></thead><tbody>{visibleRecords.map(invoice => <tr key={invoice.id}><td><button className="invoice-link" onClick={() => { setSelected(invoice); setActionError(''); }}>{invoice.invoice_number}</button><small>{invoice.items[0]?.description ?? 'Invoice'}</small></td><td>{invoice.buyer_snapshot.company || invoice.buyer_snapshot.name || clients.find(client => client.id === invoice.client)?.name}</td><td>{invoice.issued_at ? new Date(invoice.issued_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not issued'}</td><td><span className={`invoice-status invoice-${invoice.status}`}><i aria-hidden="true" />{invoice.status}</span></td><td className="invoice-row-total">{money(invoice.total_amount, invoice.currency)}</td><td><button className="invoice-preview-button" aria-label={`Preview ${invoice.invoice_number}`} title={`Preview ${invoice.invoice_number}`} onClick={() => { setSelected(invoice); setActionError(''); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M6 2.75h8l4 4V21H6z"/><path d="M14 2.75v4h4M9 12h6M9 16h6"/></svg></button></td></tr>)}</tbody></table></div> : <div className="invoice-list-state">{status || search || allRecords.length ? 'No invoices match this currency, search or status.' : <><p>No invoices yet. Create a draft to get started.</p><button className="primary" onClick={() => setEditor('new')}>Create your first invoice</button></>}</div>}
    </div>
    {editor && <Dialog title={editor === 'new' ? 'New invoice' : `Edit ${editor.invoice_number}`} onClose={() => setEditor(null)} busy={pending} className="invoice-editor-dialog"><InvoiceForm clients={clients} initial={editor === 'new' ? undefined : editor} workspaceName={workspaceName} userEmail={userEmail} onSave={save} onCancel={() => setEditor(null)} onPending={setPending} /></Dialog>}
    {selected && <Dialog title={`Invoice ${selected.invoice_number}`} drawer onClose={() => setSelected(null)} busy={pending}><div className="invoice-detail"><div className="invoice-document"><div className="invoice-document-top"><span>INVOICE</span><strong>{selected.invoice_number}</strong></div><div className="invoice-parties"><div><small>FROM</small><strong>{selected.seller_snapshot.name}</strong><span>{selected.seller_snapshot.address}</span><span>{selected.seller_snapshot.email}</span>{selected.seller_snapshot.tax_id && <span>Tax ID: {selected.seller_snapshot.tax_id}</span>}</div><div><small>BILL TO</small><strong>{selected.buyer_snapshot.company || selected.buyer_snapshot.name}</strong>{selected.buyer_snapshot.company && <span>{selected.buyer_snapshot.name}</span>}<span>{selected.buyer_snapshot.email}</span><span>{selected.buyer_snapshot.phone}</span></div></div><div className="invoice-document-meta"><span>Status: {selected.status}</span><span>Issued: {selected.issued_at ? new Date(selected.issued_at).toLocaleDateString('en-US') : 'Not issued'}</span></div><div className="invoice-table-wrap"><table><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Tax %</th><th>Amount</th></tr></thead><tbody>{selected.items.map(item => <tr key={item.id}><td>{item.description}</td><td>{item.quantity}</td><td>{money(item.unit_price, selected.currency)}</td><td>{item.tax_rate.replace(/\.0+$/, '')}</td><td>{money(item.line_total, selected.currency)}</td></tr>)}</tbody></table></div><dl className="invoice-totals"><dt>Subtotal</dt><dd>{money(selected.subtotal, selected.currency)}</dd><dt>Tax</dt><dd>{money(selected.tax_total, selected.currency)}</dd><dt>Total</dt><dd><strong>{money(selected.total_amount, selected.currency)}</strong></dd></dl></div>
      {actionError && <p role="alert" className="notice error">{actionError}</p>}
      <div className="invoice-detail-actions"><button className="secondary" disabled={pending} onClick={() => pdf(false)}>Download PDF</button><button className="secondary" disabled={pending} onClick={() => pdf(true)}>Print</button>{selected.status === 'draft' && <><button className="secondary" disabled={pending} onClick={() => { setEditor(selected); setSelected(null); }}>Edit draft</button><button className="primary" disabled={pending} onClick={() => transition('sent')}>Mark as sent</button></>}{selected.status === 'sent' && <button className="primary" disabled={pending} onClick={() => transition('paid')}>Mark as paid</button>}</div><p className="muted invoice-status-hint">Status changes are manual. Marking an invoice as sent does not email it; marking it as paid does not process a payment.</p></div></Dialog>}
  </section>;
}
