import { formatDate } from '../../utils/dates';
import ActionIcon from '../../components/ActionIcon';
import { useEffect, useState, type FormEvent } from 'react';
import Dialog from '../../components/Dialog';
import type { Client } from '../clients/api';
import { deals, type Deal } from '../deals/api';
import InvoiceForm from './InvoiceForm';
import InvoiceDocument from './InvoiceDocument';
import InvoiceLifecycle from './InvoiceLifecycle';
import {
  invoiceCurrencies,
  invoices,
  money,
  type Invoice,
  type InvoiceInput,
  type InvoiceListItem,
  type InvoiceSummary,
} from './api';
import './invoices.css';

const linkedInvoice = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('invoice');

export default function InvoicesPage({
  createRequested = false,
  onCreateHandled,
  onCountChanged,
  workspaceName,
  userEmail,
  reportingCurrency = 'USD',
  totalCount,
  isWorkspaceOwner = false,
  onOpenSecurity,
}: {
  createRequested?: boolean;
  onCreateHandled?: () => void;
  onCountChanged?: () => void;
  workspaceName: string;
  userEmail: string;
  reportingCurrency?: string;
  totalCount?: number;
  isWorkspaceOwner?: boolean;
  onOpenSecurity?: () => void;
}) {
  const [records, setRecords] = useState<InvoiceListItem[]>([]);
  const [summary, setSummary] = useState<InvoiceSummary | null>(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [summaryCurrency, setSummaryCurrency] = useState(reportingCurrency);
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
  const selectedDealId = selected?.deal;
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    const openLinked = () => {
      const id = linkedInvoice();
      if (id)
        invoices
          .detail(id)
          .then((invoice) => {
            setSelected(invoice);
            setPage(1);
            setSummaryCurrency(invoice.currency);
            setActionError('');
          })
          .catch((cause) => setActionError(cause instanceof Error ? cause.message : 'Unable to load the invoice.'));
    };
    openLinked();
    window.addEventListener('hashchange', openLinked);
    return () => window.removeEventListener('hashchange', openLinked);
  }, []);

  useEffect(() => {
    if (createRequested && !loading) {
      setEditor('new');
      onCreateHandled?.();
    }
  }, [createRequested, loading, onCreateHandled]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.all([
      invoices.page(search, status, summaryCurrency, page, controller.signal),
      invoices.summary(summaryCurrency, controller.signal),
      deals.clients(controller.signal),
    ])
      .then(([rows, totals, options]) => {
        if (!controller.signal.aborted) {
          setRecords(rows.results);
          setCount(rows.count);
          setSummary(totals);
          setClients(options);
          if (page > 1 && !rows.results.length && rows.count) setPage(page - 1);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load invoices.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [search, status, summaryCurrency, page, revision]);
  useEffect(() => {
    if (!editor && !selectedDealId) return;
    const controller = new AbortController();
    setDealError('');
    let load: Promise<Deal[]>;
    if (editor) {
      load = deals.list({ search: '', status: '', currency: '' }, controller.signal).then((result) => result.results);
    } else if (selectedDealId) {
      load = deals.detail(selectedDealId, controller.signal).then((deal) => [deal]);
    } else {
      return;
    }
    load
      .then((result) => {
        if (!controller.signal.aborted) setClientDeals(result);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setDealError(cause instanceof Error ? cause.message : 'Unable to load deals.');
      });
    return () => controller.abort();
  }, [editor, selectedDealId, revision]);

  function refresh() {
    setRevision((value) => value + 1);
  }
  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSearch(draft.trim());
  }
  async function save(values: InvoiceInput) {
    const creating = editor === 'new';
    const saved = creating ? await invoices.create(values) : await invoices.update((editor as Invoice).id, values);
    setEditor(null);
    setSelected(saved);
    setPage(1);
    setSummaryCurrency(saved.currency);
    if (creating) {
      setDraft('');
      setSearch('');
      setStatus('');
    }
    setMessage(creating ? 'Invoice created.' : 'Draft updated.');
    refresh();
    onCountChanged?.();
  }
  async function transition() {
    if (!selected || pending) return;
    setPending(true);
    setActionError('');
    try {
      const updated = await invoices.status(selected.id, 'sent');
      setSelected(updated);
      setMessage('Invoice issued. Email delivery is a separate action.');
      refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Unable to update the invoice.');
    } finally {
      setPending(false);
    }
  }
  async function lifecycleAction(operation: () => Promise<Invoice>, success: string) {
    if (pending) return false;
    setPending(true);
    setActionError('');
    try {
      const updated = await operation();
      setSelected(updated);
      setMessage(success);
      refresh();
      return true;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Unable to update the invoice.');
      if (selected)
        invoices
          .detail(selected.id)
          .then(setSelected)
          .catch(() => {});
      return false;
    } finally {
      setPending(false);
    }
  }
  async function openInvoice(id: string) {
    setActionError('');
    try {
      setSelected(await invoices.detail(id));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Unable to load the invoice.');
    }
  }
  async function pdf(print = false) {
    if (!selected || pending) return;
    setPending(true);
    setActionError('');
    try {
      const blob = await invoices.pdf(selected.id);
      const url = URL.createObjectURL(blob);
      if (print) {
        const frame = document.createElement('iframe');
        frame.style.display = 'none';
        frame.src = url;
        frame.title = 'Invoice print document';
        frame.onload = () => {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
          setTimeout(() => {
            frame.remove();
            URL.revokeObjectURL(url);
          }, 60000);
        };
        document.body.append(frame);
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = `${selected.invoice_number}.pdf`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Unable to prepare the PDF.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="invoices-page" aria-label="Company invoices">
      {message && (
        <p role="status" className="notice success">
          {message}
        </p>
      )}
      {actionError && !selected && (
        <p role="alert" className="notice error">
          {actionError}
        </p>
      )}
      <div className="invoice-summary-heading">
        <p className="muted">Showing invoices and totals in the selected currency.</p>
        <label>
          <span className="sr-only">Summary currency</span>
          <select
            aria-label="Summary currency"
            value={summaryCurrency}
            onChange={(event) => {
              setPage(1);
              setSummaryCurrency(event.target.value);
            }}
          >
            {invoiceCurrencies.map((currency) => (
              <option key={currency}>{currency}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="invoice-summary">
        {(['sent', 'paid', 'draft', 'overdue'] as const).map((item) => (
          <article className="panel" key={item}>
            <span className={`invoice-summary-label invoice-summary-${item}`}>
              <i aria-hidden="true" />
              {{ sent: 'Outstanding', paid: 'Received', draft: 'Drafts', overdue: 'Overdue' }[item]}
            </span>
            <strong>
              {summary
                ? `${summaryCurrency === 'USD' ? '$' : summaryCurrency === 'EUR' ? '€' : ''}${money(summary[item].amount, summaryCurrency).replace(summaryCurrency === 'USD' || summaryCurrency === 'EUR' ? ` ${summaryCurrency}` : '', '')}`
                : '—'}
            </strong>
            <small>
              {summaryCurrency} · {summary?.[item].count ?? 0} invoices
            </small>
          </article>
        ))}
      </div>
      <div className="panel invoice-list">
        <div className="invoice-toolbar">
          <div className="invoice-status-filters" role="group" aria-label="Invoice status">
            {(['', 'draft', 'sent', 'overdue', 'paid', 'cancelled'] as const).map((item) => (
              <button
                key={item}
                aria-pressed={status === item}
                onClick={() => {
                  setPage(1);
                  setStatus(item);
                }}
              >
                {item ? item[0].toUpperCase() + item.slice(1) : 'All invoices'}
              </button>
            ))}
          </div>
          <form onSubmit={submitSearch}>
            <input
              aria-label="Search invoices"
              placeholder="Search number or client"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button className="secondary">
              <ActionIcon name="search" />
              Search
            </button>
          </form>
          <button className="secondary" onClick={refresh}>
            <ActionIcon name="refresh" />
            Refresh
          </button>
        </div>
        {error && (
          <p role="alert" className="notice error">
            {error}{' '}
            <button className="secondary" onClick={refresh}>
              Retry
            </button>
          </p>
        )}
        {loading ? (
          <p role="status" className="invoice-list-state">
            Loading invoices…
          </p>
        ) : records.length ? (
          <div className="invoice-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Client</th>
                  <th>Issued</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Preview</th>
                </tr>
              </thead>
              <tbody>
                {records.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <button
                        className="invoice-link"
                        onClick={() => {
                          void openInvoice(invoice.id);
                        }}
                      >
                        {invoice.invoice_number}
                      </button>
                      <small>{invoice.description || 'Invoice'}</small>
                    </td>
                    <td>{invoice.client_company || invoice.client_name}</td>
                    <td>
                      {invoice.issued_on || invoice.issued_at
                        ? new Date(
                            invoice.issued_on ? `${invoice.issued_on}T00:00:00` : invoice.issued_at!,
                          ).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : 'Not issued'}
                    </td>
                    <td>{invoice.needs_due_date ? 'Needs due date' : formatDate(invoice.due_date, 'No due date')}</td>
                    <td>
                      <span className={`invoice-status invoice-${invoice.overdue ? 'overdue' : invoice.status}`}>
                        <i aria-hidden="true" />
                        {invoice.overdue ? 'Overdue' : invoice.status}
                      </span>
                    </td>
                    <td className="invoice-row-total">{money(invoice.total_amount, invoice.currency)}</td>
                    <td>
                      <button
                        className="invoice-preview-button"
                        aria-label={`Preview ${invoice.invoice_number}`}
                        title={`Preview ${invoice.invoice_number}`}
                        onClick={() => {
                          void openInvoice(invoice.id);
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                          <path d="M6 2.75h8l4 4V21H6z" />
                          <path d="M14 2.75v4h4M9 12h6M9 16h6" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="invoice-list-state">
            {totalCount === 0 && !status && !search ? (
              <>
                <p>No invoices yet. Create a draft to get started.</p>
                <button className="primary" onClick={() => setEditor('new')}>
                  Create your first invoice
                </button>
              </>
            ) : (
              <>
                <p>
                  No invoices match {summaryCurrency}
                  {status ? ` and ${status} status` : ''}
                  {search ? ` and "${search}"` : ''}.
                </p>
                <p className="muted">Choose another currency or change the search and status filters.</p>
              </>
            )}
          </div>
        )}
        <footer className="pagination">
          <span>
            {count} invoices · Page {page}
          </span>
          <div className="button-row">
            <button
              className="secondary"
              disabled={loading || page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </button>
            <button
              className="secondary"
              disabled={loading || page * 20 >= count}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        </footer>
      </div>
      {editor && (
        <Dialog
          title={editor === 'new' ? 'New invoice' : `Edit ${editor.invoice_number}`}
          onClose={() => setEditor(null)}
          busy={pending}
          className="invoice-editor-dialog"
        >
          <InvoiceForm
            clients={clients}
            deals={clientDeals}
            dealError={dealError}
            initial={editor === 'new' ? undefined : editor}
            workspaceName={workspaceName}
            userEmail={userEmail}
            isWorkspaceOwner={isWorkspaceOwner}
            onOpenSecurity={onOpenSecurity}
            onSave={save}
            onCancel={() => setEditor(null)}
            onPending={setPending}
          />
        </Dialog>
      )}
      {selected && (
        <Dialog
          title={`Invoice ${selected.invoice_number}`}
          drawer
          onClose={() => {
            setSelected(null);
            if (linkedInvoice())
              window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/invoices`);
          }}
          busy={pending}
        >
          <div className="invoice-detail">
            <InvoiceDocument
              invoiceNumber={selected.invoice_number}
              currency={selected.currency}
              status={selected.status}
              seller={selected.seller_snapshot}
              buyer={selected.buyer_snapshot}
              items={selected.items.map((item) => ({ ...item, line_total: item.line_total }))}
              issuedAt={selected.issued_at}
              issuedOn={selected.issued_on}
              dueDate={selected.due_date}
              dueDateFallback={selected.status === 'draft' ? '30 days after issue' : 'No due date'}
              paymentTerms={selected.payment_terms}
              statusNote={selected.status === 'cancelled' ? `Cancelled: ${selected.cancellation_reason}` : undefined}
              subtotal={selected.subtotal}
              taxTotal={selected.tax_total}
              total={selected.total_amount}
            />
            <div className="invoice-linked-deal">
              Deal:{' '}
              {selected.deal ? (
                <button
                  className="client-name"
                  onClick={() => {
                    window.location.hash = `/deals?deal=${encodeURIComponent(selected.deal!)}`;
                  }}
                >
                  {clientDeals.find((deal) => deal.id === selected.deal)?.title ?? 'Open linked deal'} →
                </button>
              ) : (
                <span className="muted">Not linked</span>
              )}
            </div>
            <InvoiceLifecycle invoice={selected} busy={pending} onAction={lifecycleAction} />
            {actionError && (
              <p role="alert" className="notice error">
                {actionError}
              </p>
            )}
            <div className="invoice-detail-actions">
              <button className="secondary" disabled={pending} onClick={() => pdf(false)}>
                Download PDF
              </button>
              <button className="secondary" disabled={pending} onClick={() => pdf(true)}>
                Print
              </button>
              {selected.status === 'draft' && (
                <>
                  <button
                    className="secondary"
                    disabled={pending}
                    onClick={() => {
                      setEditor(selected);
                      setSelected(null);
                    }}
                  >
                    Edit draft
                  </button>
                  <button className="primary" disabled={pending} onClick={() => transition()}>
                    Issue without email
                  </button>
                </>
              )}
            </div>
            <p className="muted invoice-status-hint">
              Payments are recorded manually after you confirm receipt. Sending an email does not collect payment.
            </p>
          </div>
        </Dialog>
      )}
    </section>
  );
}
