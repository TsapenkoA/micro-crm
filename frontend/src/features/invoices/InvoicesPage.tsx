import ActionIcon from '../../components/ActionIcon';
import { useEffect, useState, type FormEvent } from 'react';
import Dialog from '../../components/Dialog';
import { bankFields } from '../../components/BankDetailsFields';
import type { Client } from '../clients/api';
import { deals, type Deal } from '../deals/api';
import InvoiceForm from './InvoiceForm';
import InvoiceLifecycle from './InvoiceLifecycle';
import { currencyPlaces, invoiceCurrencies, invoices, money, type Invoice, type InvoiceInput } from './api';
import './invoices.css';

function summaryAmount(records: Invoice[], status: 'sent' | 'paid' | 'draft' | 'overdue', currency: string) {
  const places = currencyPlaces[currency as keyof typeof currencyPlaces];
  const unit = 10n ** BigInt(places);
  const total = records.filter(invoice => invoice.currency === currency && (status === 'paid' ? Number(invoice.paid_amount) > 0 : status === 'overdue' ? invoice.overdue : invoice.status === status)).reduce((sum, invoice) => {
    const value = status === 'paid' ? invoice.paid_amount : status === 'sent' || status === 'overdue' ? invoice.balance_due : invoice.total_amount;
    const [whole, fraction = ''] = value.split('.');
    return sum + BigInt(whole) * unit + BigInt(fraction.padEnd(places, '0').slice(0, places) || '0');
  }, 0n);
  const value = places ? `${total / unit}.${String(total % unit).padStart(places, '0')}` : String(total);
  const formatted = money(value, currency);
  return currency === 'USD' || currency === 'EUR' ? `${currency === 'USD' ? '$' : '€'}${formatted.replace(` ${currency}`, '')}` : formatted;
}

const linkedInvoice = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('invoice');

export default function InvoicesPage({ createRequested = false, onCreateHandled, onCountChanged, workspaceName, userEmail }: {
  createRequested?: boolean; onCreateHandled?: () => void; onCountChanged?: () => void; workspaceName: string; userEmail: string;
}) {
  const [records, setRecords] = useState<Invoice[]>([]);
  const [allRecords, setAllRecords] = useState<Invoice[]>([]);
  const [summaryCurrency, setSummaryCurrency] = useState('USD');
  const [clients, setClients] = useState<Client[]>([]);
  const [clientDeals, setClientDeals] = useState<Deal[]>([]);
  const [dealError, setDealError] = useState('');
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

  useEffect(() => {
    const openLinked = () => {
      const id = linkedInvoice();
      if (id) invoices.detail(id).then(invoice => { setSelected(invoice); setSummaryCurrency(invoice.currency); setActionError(''); }).catch(cause => setActionError(cause instanceof Error ? cause.message : 'Unable to load the invoice.'));
    };
    openLinked();
    window.addEventListener('hashchange', openLinked);
    return () => window.removeEventListener('hashchange', openLinked);
  }, []);

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
  useEffect(() => {
    const controller = new AbortController();
    setDealError('');
    deals.list({ search: '', status: '', currency: '' }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setClientDeals(result.results); })
      .catch(cause => { if (!controller.signal.aborted) setDealError(cause instanceof Error ? cause.message : 'Unable to load deals.'); });
    return () => controller.abort();
  }, [revision]);

  function refresh() { setRevision(value => value + 1); }
  function submitSearch(event: FormEvent) { event.preventDefault(); setSearch(draft.trim()); }
  async function save(values: InvoiceInput) {
    const saved = editor === 'new' ? await invoices.create(values) : await invoices.update((editor as Invoice).id, values);
    setEditor(null); setSelected(saved); setMessage(editor === 'new' ? 'Invoice created.' : 'Draft updated.'); refresh(); onCountChanged?.();
  }
  async function transition() {
    if (!selected || pending) return;
    setPending(true); setActionError('');
    try { const updated = await invoices.status(selected.id, 'sent'); setSelected(updated); setMessage('Invoice issued. Email delivery is a separate action.'); refresh(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Unable to update the invoice.'); }
    finally { setPending(false); }
  }
  async function lifecycleAction(operation: () => Promise<Invoice>, success: string) {
    if (pending) return false;
    setPending(true); setActionError('');
    try { const updated = await operation(); setSelected(updated); setMessage(success); refresh(); return true; }
    catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Unable to update the invoice.');
      if (selected) invoices.detail(selected.id).then(setSelected).catch(() => {});
      return false;
    }
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
    {actionError && !selected && <p role="alert" className="notice error">{actionError}</p>}
    <div className="invoice-summary-heading"><p className="muted">Showing invoices and totals in the selected currency.</p><label><span className="sr-only">Summary currency</span><select aria-label="Summary currency" value={summaryCurrency} onChange={event => setSummaryCurrency(event.target.value)}>{invoiceCurrencies.map(currency => <option key={currency}>{currency}</option>)}</select></label></div>
    <div className="invoice-summary">{(['sent', 'paid', 'draft', 'overdue'] as const).map(item => <article className="panel" key={item}><span className={`invoice-summary-label invoice-summary-${item}`}><i aria-hidden="true" />{{ sent: 'Outstanding', paid: 'Received', draft: 'Drafts', overdue: 'Overdue' }[item]}</span><strong>{summaryAmount(allRecords, item, summaryCurrency)}</strong><small>{summaryCurrency} · {allRecords.filter(invoice => invoice.currency === summaryCurrency && (item === 'paid' ? Number(invoice.paid_amount) > 0 : item === 'overdue' ? invoice.overdue : invoice.status === item)).length} invoices</small></article>)}</div>
    <div className="panel invoice-list"><div className="invoice-toolbar"><div className="invoice-status-filters" role="group" aria-label="Invoice status">{(['', 'draft', 'sent', 'overdue', 'paid', 'cancelled'] as const).map(item => <button key={item} aria-pressed={status === item} onClick={() => setStatus(item)}>{item ? item[0].toUpperCase() + item.slice(1) : 'All invoices'}</button>)}</div><form onSubmit={submitSearch}><input aria-label="Search invoices" placeholder="Search number or client" value={draft} onChange={event => setDraft(event.target.value)} /><button className="secondary"><ActionIcon name="search" />Search</button></form><button className="secondary" onClick={refresh}><ActionIcon name="refresh" />Refresh</button></div>
      {error && <p role="alert" className="notice error">{error} <button className="secondary" onClick={refresh}>Retry</button></p>}
      {loading ? <p role="status" className="invoice-list-state">Loading invoices…</p> : visibleRecords.length ? <div className="invoice-table-wrap"><table><thead><tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Due</th><th>Status</th><th>Total</th><th>Preview</th></tr></thead><tbody>{visibleRecords.map(invoice => <tr key={invoice.id}><td><button className="invoice-link" onClick={() => { setSelected(invoice); setActionError(''); }}>{invoice.invoice_number}</button><small>{invoice.items[0]?.description ?? 'Invoice'}</small></td><td>{invoice.buyer_snapshot.company || invoice.buyer_snapshot.name || clients.find(client => client.id === invoice.client)?.name}</td><td>{invoice.issued_at ? new Date(invoice.issued_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not issued'}</td><td>{invoice.due_date || '—'}</td><td><span className={`invoice-status invoice-${invoice.overdue ? 'overdue' : invoice.status}`}><i aria-hidden="true" />{invoice.overdue ? 'Overdue' : invoice.status}</span></td><td className="invoice-row-total">{money(invoice.total_amount, invoice.currency)}</td><td><button className="invoice-preview-button" aria-label={`Preview ${invoice.invoice_number}`} title={`Preview ${invoice.invoice_number}`} onClick={() => { setSelected(invoice); setActionError(''); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M6 2.75h8l4 4V21H6z"/><path d="M14 2.75v4h4M9 12h6M9 16h6"/></svg></button></td></tr>)}</tbody></table></div> : <div className="invoice-list-state">{status || search || allRecords.length ? 'No invoices match this currency, search or status.' : <><p>No invoices yet. Create a draft to get started.</p><button className="primary" onClick={() => setEditor('new')}>Create your first invoice</button></>}</div>}
    </div>
    {editor && <Dialog title={editor === 'new' ? 'New invoice' : `Edit ${editor.invoice_number}`} onClose={() => setEditor(null)} busy={pending} className="invoice-editor-dialog"><InvoiceForm clients={clients} deals={clientDeals} dealError={dealError} initial={editor === 'new' ? undefined : editor} workspaceName={workspaceName} userEmail={userEmail} onSave={save} onCancel={() => setEditor(null)} onPending={setPending} /></Dialog>}
    {selected && <Dialog title={`Invoice ${selected.invoice_number}`} drawer onClose={() => { setSelected(null); if (linkedInvoice()) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/invoices`); }} busy={pending}><div className="invoice-detail"><div className="invoice-document"><div className="invoice-document-top"><span>INVOICE</span><strong>{selected.invoice_number}</strong></div><div className="invoice-parties"><div><small>FROM</small><strong>{selected.seller_snapshot.name}</strong><span>{selected.seller_snapshot.address}</span><span>{selected.seller_snapshot.email}</span><span>{selected.seller_snapshot.phone}</span>{selected.seller_snapshot.tax_id && <span>Tax ID: {selected.seller_snapshot.tax_id}</span>}</div><div><small>BILL TO</small><strong>{selected.buyer_snapshot.company || selected.buyer_snapshot.name}</strong>{selected.buyer_snapshot.company && <span>{selected.buyer_snapshot.name}</span>}<span>{selected.buyer_snapshot.email}</span><span>{selected.buyer_snapshot.phone}</span></div></div>{(selected.seller_snapshot.bank_details || selected.buyer_snapshot.bank_details) && <div className="invoice-parties invoice-bank-parties">{([['PAYMENT TO', selected.seller_snapshot.bank_details], ['PAYER BANK', selected.buyer_snapshot.bank_details]] as const).map(([title, details]) => <div key={title}>{details && bankFields.some(([field]) => details[field]) && <><small>{title}</small>{bankFields.filter(([field]) => details[field]).map(([field, label]) => <span key={field}>{label}: {details[field]}</span>)}</>}</div>)}</div>}<div className="invoice-document-meta"><span>Status: {selected.status}</span><span>Issued: {selected.issued_at ? new Date(selected.issued_at).toLocaleDateString('en-US') : 'Not issued'}</span><span>Due: {selected.due_date || 'Not set'}</span></div>{selected.payment_terms && <p className="invoice-document-terms">Payment terms: {selected.payment_terms}</p>}{selected.status === 'cancelled' && <p className="invoice-document-terms">Cancelled: {selected.cancellation_reason}</p>}<div className="invoice-table-wrap"><table><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Tax %</th><th>Amount</th></tr></thead><tbody>{selected.items.map(item => <tr key={item.id}><td>{item.description}</td><td>{item.quantity}</td><td>{money(item.unit_price, selected.currency)}</td><td>{item.tax_rate.replace(/\.0+$/, '')}</td><td>{money(item.line_total, selected.currency)}</td></tr>)}</tbody></table></div><dl className="invoice-totals"><dt>Subtotal</dt><dd>{money(selected.subtotal, selected.currency)}</dd><dt>Tax</dt><dd>{money(selected.tax_total, selected.currency)}</dd><dt>Total</dt><dd><strong>{money(selected.total_amount, selected.currency)}</strong></dd></dl></div>
      <div className="invoice-linked-deal">Deal: {selected.deal ? <button className="client-name" onClick={() => { window.location.hash = `/deals?deal=${encodeURIComponent(selected.deal!)}`; }}>{clientDeals.find(deal => deal.id === selected.deal)?.title ?? 'Open linked deal'} →</button> : <span className="muted">Not linked</span>}</div>
      <InvoiceLifecycle invoice={selected} busy={pending} onAction={lifecycleAction} />
      {actionError && <p role="alert" className="notice error">{actionError}</p>}
      <div className="invoice-detail-actions"><button className="secondary" disabled={pending} onClick={() => pdf(false)}>Download PDF</button><button className="secondary" disabled={pending} onClick={() => pdf(true)}>Print</button>{selected.status === 'draft' && <><button className="secondary" disabled={pending} onClick={() => { setEditor(selected); setSelected(null); }}>Edit draft</button><button className="primary" disabled={pending} onClick={() => transition()}>Issue without email</button></>}</div><p className="muted invoice-status-hint">Payments are recorded manually after you confirm receipt. Sending an email does not collect payment.</p></div></Dialog>}
  </section>;
}
