import { useState, type FormEvent } from 'react';
import { invoices, money, type Invoice, type ReminderPreview } from './api';

const today = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export default function InvoiceLifecycle({ invoice, busy, onAction }: {
  invoice: Invoice;
  busy: boolean;
  onAction: (operation: () => Promise<Invoice>, message: string) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<'payment' | 'send' | 'reminder' | 'cancel' | 'due' | 'void' | null>(null);
  const [amount, setAmount] = useState(invoice.balance_due);
  const [receivedOn, setReceivedOn] = useState(today);
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [dueDate, setDueDate] = useState(invoice.due_date || '');
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const emailed = invoice.deliveries.some(delivery => delivery.kind === 'invoice' && ['accepted', 'pending', 'unknown'].includes(delivery.result));

  async function act(operation: () => Promise<Invoice>, message: string) {
    if (await onAction(operation, message)) setMode(null);
  }

  async function reviewReminder() {
    setMode('reminder'); setPreview(null); setPreviewError(''); setPreviewLoading(true);
    try { setPreview(await invoices.reminderPreview(invoice.id)); }
    catch (cause) { setPreviewError(cause instanceof Error ? cause.message : 'Unable to prepare the reminder.'); }
    finally { setPreviewLoading(false); }
  }

  function submitPayment(event: FormEvent) {
    event.preventDefault();
    void act(() => invoices.payment(invoice.id, amount, receivedOn, reference.trim()), 'Payment recorded.');
  }

  return <section className="invoice-lifecycle" aria-label="Invoice lifecycle">
    <div className="invoice-lifecycle-summary"><span>Due: <strong>{invoice.due_date || 'Not set'}</strong></span><span>Recorded payments: <strong>{money(invoice.paid_amount, invoice.currency)}</strong></span><span>Balance: <strong>{money(invoice.balance_due, invoice.currency)}</strong></span>{invoice.overdue && <strong className="invoice-overdue">Overdue</strong>}</div>
    {invoice.payment_terms && <p className="muted">Payment terms: {invoice.payment_terms}</p>}
    {invoice.cancelled_at && <p className="notice error">Cancelled: {invoice.cancellation_reason}</p>}
    <div className="invoice-lifecycle-actions">
      {(invoice.status === 'draft' || invoice.status === 'sent') && !emailed && <button className="secondary" disabled={busy} onClick={() => setMode('send')}>Email PDF to client</button>}
      {invoice.status === 'sent' && <><button className="secondary" disabled={busy} onClick={() => { setAmount(invoice.balance_due); setMode('payment'); }}>Record payment</button><button className="secondary" disabled={busy} onClick={() => { setDueDate(invoice.due_date || ''); setReason(''); setMode('due'); }}>Correct due date</button>{invoice.overdue && <button className="secondary" disabled={busy} onClick={() => void reviewReminder()}>Review reminder</button>}</>}
      {(invoice.status === 'draft' || invoice.status === 'sent') && !invoice.payments.some(payment => !payment.voided_at) && <button className="text-action danger" disabled={busy} onClick={() => setMode('cancel')}>Cancel invoice</button>}
    </div>
    {mode === 'send' && <div className="invoice-action-panel"><h3>Send invoice PDF</h3><p>The PDF will be emailed to {invoice.buyer_snapshot.email || 'the client address'}. The mail server’s acceptance will be recorded; inbox delivery cannot be guaranteed.</p><div className="button-row"><button className="secondary" disabled={busy} onClick={() => setMode(null)}>Back</button><button className="primary" disabled={busy} onClick={() => void act(() => invoices.send(invoice.id), 'Invoice email accepted by the mail server.')}>Send PDF</button></div></div>}
    {mode === 'payment' && <form className="invoice-action-panel" onSubmit={submitPayment}><h3>Record a received payment</h3><p className="muted">Record only money you have confirmed receiving. This does not charge the client.</p><div className="invoice-payment-fields"><label>Amount ({invoice.currency})<input type="number" min="0" step={invoice.currency === 'JPY' ? '1' : '0.01'} required value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} /></label><label>Received on<input type="date" required value={receivedOn} disabled={busy} onChange={event => setReceivedOn(event.target.value)} /></label><label>Reference (optional)<input maxLength={200} value={reference} disabled={busy} onChange={event => setReference(event.target.value)} /></label></div><div className="button-row"><button type="button" className="secondary" disabled={busy} onClick={() => setMode(null)}>Back</button><button className="primary" disabled={busy}>Record payment</button></div></form>}
    {mode === 'due' && <form className="invoice-action-panel" onSubmit={event => { event.preventDefault(); void act(() => invoices.correctDueDate(invoice.id, dueDate, reason.trim()), 'Due date correction recorded.'); }}><h3>Correct due date</h3><p>The correction and reason will appear in the invoice history and PDF. Notify the client if they already received the document.</p><label>Due date<input type="date" required value={dueDate} disabled={busy} onChange={event => setDueDate(event.target.value)} /></label><label>Reason<textarea required maxLength={500} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label><div className="button-row"><button type="button" className="secondary" onClick={() => setMode(null)}>Back</button><button className="primary" disabled={busy || !reason.trim()}>Save correction</button></div></form>}
    {mode === 'void' && paymentId !== null && <form className="invoice-action-panel" onSubmit={event => { event.preventDefault(); void act(() => invoices.voidPayment(invoice.id, paymentId, reason.trim()), 'Payment reversal recorded.'); }}><h3>Reverse payment</h3><p>The original payment remains in the history. The balance and reports will be recalculated.</p><label>Reason<textarea required maxLength={500} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label><div className="button-row"><button type="button" className="secondary" onClick={() => setMode(null)}>Back</button><button className="primary destructive" disabled={busy || !reason.trim()}>Confirm reversal</button></div></form>}
    {mode === 'reminder' && <div className="invoice-action-panel"><h3>Payment reminder</h3>{previewLoading ? <p role="status">Preparing reminder…</p> : previewError ? <p role="alert">{previewError}</p> : preview && <><p><strong>{preview.subject}</strong></p><pre>{preview.body}</pre>{!preview.can_send && <p role="alert">{preview.reason}</p>}</>}<div className="button-row"><button className="secondary" disabled={busy} onClick={() => setMode(null)}>Back</button><button className="primary" disabled={busy || !preview?.can_send} onClick={() => void act(() => invoices.remind(invoice.id), 'Reminder accepted by the mail server.')}>Send reminder</button></div></div>}
    {mode === 'cancel' && <div className="invoice-action-panel"><h3>Cancel invoice</h3><p className="muted">The document and amount remain in the audit record. If it was already emailed, notify the client separately.</p><label>Reason<textarea maxLength={500} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label><div className="button-row"><button className="secondary" disabled={busy} onClick={() => setMode(null)}>Back</button><button className="primary destructive" disabled={busy || !reason.trim()} onClick={() => void act(() => invoices.cancel(invoice.id, reason.trim()), 'Invoice cancelled.')}>Confirm cancellation</button></div></div>}
    {invoice.due_date_corrections.length > 0 && <div className="invoice-history"><h3>Due date corrections</h3><ul>{invoice.due_date_corrections.map(correction => <li key={correction.id}>{new Date(correction.created_at).toLocaleString('en-US')} · {correction.previous_due_date || 'Not set'} → {correction.due_date} · {correction.reason}</li>)}</ul></div>}
    {invoice.payments.length > 0 && <div className="invoice-history"><h3>Recorded payments</h3><ul>{invoice.payments.map(payment => <li key={payment.id}>{payment.received_on} · {money(payment.amount, invoice.currency)}{payment.reference && ` · ${payment.reference}`}{payment.is_legacy && ' · Previously marked paid'}{payment.voided_at && ` · Reversed: ${payment.void_reason}`}{!payment.voided_at && !payment.is_legacy && <button type="button" className="text-action danger" disabled={busy} onClick={() => { setPaymentId(payment.id); setReason(''); setMode('void'); }}>Reverse</button>}</li>)}</ul></div>}
    {invoice.deliveries.length > 0 && <div className="invoice-history"><h3>Email attempts</h3><ul>{invoice.deliveries.map(delivery => <li key={delivery.id}>{new Date(delivery.attempted_at).toLocaleString('en-US')} · {delivery.kind === 'reminder' ? 'Reminder' : 'Invoice PDF'} · {delivery.result === 'accepted' ? 'Accepted by mail server' : delivery.result === 'failed' ? 'Failed' : delivery.result === 'unknown' ? 'Outcome unknown — contact support' : 'Pending'} · {delivery.recipient}{delivery.resolved_at && ` · Investigated: ${delivery.resolution_reason}`}</li>)}</ul></div>}
  </section>;
}
