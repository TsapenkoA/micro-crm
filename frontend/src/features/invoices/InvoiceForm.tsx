import { useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError, workspace, type BankDetails, type SellerDetails } from '../../api/client';
import DateInput from '../../components/DateInput';
import { clients as clientApi, type Client, type ClientDetail } from '../clients/api';
import type { Deal } from '../deals/api';
import { currencyPlaces, invoiceCurrencies, type Invoice, type InvoiceInput, type InvoiceItemInput } from './api';
import InvoiceDocument, { type InvoiceDocumentItem } from './InvoiceDocument';

const blankItem = (): InvoiceItemInput => ({ description: '', quantity: '1', unit_price: '', tax_rate: '0' });
type InvoiceDraftValues = InvoiceInput & { seller: NonNullable<InvoiceInput['seller']> };
type EstimatedItem = { line: bigint };

function cleanSeller(seller: InvoiceDraftValues['seller']): InvoiceDraftValues['seller'] {
  return {
    name: seller.name.trim(),
    email: seller.email.trim(),
    phone: seller.phone.trim(),
    address: seller.address.trim(),
    tax_id: seller.tax_id.trim(),
  };
}

function scaled(value: string, digits: number) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > digits) return null;
  return BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0');
}

function formatMinor(value: bigint, places: number) {
  const unit = 10n ** BigInt(places);
  return places ? `${value / unit}.${String(value % unit).padStart(places, '0')}` : String(value);
}

function estimate(items: InvoiceItemInput[], currency: string) {
  const places = currencyPlaces[currency as keyof typeof currencyPlaces];
  if (places === undefined) return null;
  const divisor = 10n ** BigInt(7 - places);
  let subtotal = 0n;
  let taxTotal = 0n;
  const calculated: EstimatedItem[] = [];

  for (const item of items) {
    const quantity = scaled(item.quantity, 3);
    const price = scaled(item.unit_price, 4);
    const rate = scaled(item.tax_rate, 4);
    if (quantity === null || price === null || rate === null) return null;

    const line = (quantity * price + divisor / 2n) / divisor;
    const tax = (line * rate + 500000n) / 1000000n;
    calculated.push({ line });
    subtotal += line;
    taxTotal += tax;
  }

  return {
    items: calculated,
    subtotal: formatMinor(subtotal, places),
    tax: formatMinor(taxTotal, places),
    total: formatMinor(subtotal + taxTotal, places),
  };
}

function message(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(message).filter(Boolean).join(' ');
  return '';
}

function loadError(cause: unknown, requiresRecentAuth = false): string {
  if (requiresRecentAuth && cause instanceof ApiError && cause.status === 403) {
    return 'Confirm your identity in Settings > Security, then retry loading the saved details.';
  }
  return cause instanceof Error ? cause.message : 'Unable to load saved invoice details.';
}

export default function InvoiceForm({
  clients,
  deals,
  dealError = '',
  initial,
  workspaceName,
  userEmail,
  isWorkspaceOwner = false,
  onOpenSecurity,
  onSave,
  onCancel,
  onPending,
}: {
  clients: Client[];
  deals: Deal[];
  dealError?: string;
  initial?: Invoice;
  workspaceName: string;
  userEmail: string;
  isWorkspaceOwner?: boolean;
  onOpenSecurity?: () => void;
  onSave: (values: InvoiceInput) => Promise<void>;
  onCancel: () => void;
  onPending: (value: boolean) => void;
}) {
  const id = useId();
  const [values, setValues] = useState<InvoiceDraftValues>({
    client: initial?.client ?? '',
    deal: initial?.deal ?? null,
    currency: initial?.currency ?? 'USD',
    due_date: initial?.due_date ?? null,
    payment_terms: initial?.payment_terms ?? '',
    seller: {
      name: initial?.seller_snapshot.name ?? workspaceName,
      email: initial?.seller_snapshot.email ?? userEmail,
      phone: initial?.seller_snapshot.phone ?? '',
      address: initial?.seller_snapshot.address ?? '',
      tax_id: initial?.seller_snapshot.tax_id ?? '',
    },
    items: initial?.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      tax_rate: item.tax_rate,
    })) ?? [blankItem()],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  const [pending, setPending] = useState(false);
  const [sellerBankDetails, setSellerBankDetails] = useState<BankDetails>(initial?.seller_snapshot.bank_details ?? {});
  const [sellerDetailsLoaded, setSellerDetailsLoaded] = useState(Boolean(initial));
  const [workspaceDetailsLoading, setWorkspaceDetailsLoading] = useState(!initial && isWorkspaceOwner);
  const [workspaceDetailsError, setWorkspaceDetailsError] = useState('');
  const [workspaceNeedsSecurity, setWorkspaceNeedsSecurity] = useState(false);
  const [workspaceDetailsRetry, setWorkspaceDetailsRetry] = useState(0);
  const [previewClient, setPreviewClient] = useState<ClientDetail | null>(null);
  const [clientDetailsLoading, setClientDetailsLoading] = useState(false);
  const [clientDetailsError, setClientDetailsError] = useState('');
  const [clientDetailsRetry, setClientDetailsRetry] = useState(0);
  const totals = estimate(values.items, values.currency);
  const places = currencyPlaces[values.currency as keyof typeof currencyPlaces];
  const selectedClient = clients.find((client) => client.id === values.client);
  const detailedClient = previewClient?.id === values.client ? previewClient : null;
  const previewItems: InvoiceDocumentItem[] = values.items.map((item, index) => ({
    ...item,
    line_total: totals && places !== undefined ? formatMinor(totals.items[index].line, places) : null,
  }));
  const fieldId = (field: string) => `${id}-${field}`;
  const errorProps = (field: string) => ({
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? `${fieldId(field)}-error` : undefined,
  });

  useEffect(() => {
    if (initial || !isWorkspaceOwner) return;

    const controller = new AbortController();
    setWorkspaceDetailsLoading(true);
    setWorkspaceDetailsError('');
    setWorkspaceNeedsSecurity(false);

    const sellerRequest = workspace.sellerDetails(controller.signal).then((seller: SellerDetails) => {
      if (controller.signal.aborted) return;
      setValues((current) => ({
        ...current,
        seller: {
          name: seller.name || workspaceName,
          email: seller.email || userEmail,
          phone: seller.phone ?? '',
          address: seller.address ?? '',
          tax_id: seller.tax_id ?? '',
        },
      }));
      setSellerDetailsLoaded(true);
    });
    const bankRequest = workspace.bankDetails(controller.signal).then((details) => {
      if (!controller.signal.aborted) setSellerBankDetails(details);
    });

    Promise.allSettled([sellerRequest, bankRequest])
      .then((results) => {
        if (controller.signal.aborted) return;
        const failures = results.flatMap((result) =>
          result.status === 'rejected' ? [loadError(result.reason, true)] : [],
        );
        setWorkspaceDetailsError([...new Set(failures)].join(' '));
        setWorkspaceNeedsSecurity(
          results.some(
            (result) =>
              result.status === 'rejected' && result.reason instanceof ApiError && result.reason.status === 403,
          ),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setWorkspaceDetailsLoading(false);
      });

    return () => controller.abort();
  }, [initial, isWorkspaceOwner, userEmail, workspaceDetailsRetry, workspaceName]);

  useEffect(() => {
    if (initial || !values.client) {
      setPreviewClient(null);
      setClientDetailsError('');
      setClientDetailsLoading(false);
      return;
    }

    const controller = new AbortController();
    setClientDetailsLoading(true);
    setClientDetailsError('');
    clientApi
      .detail(values.client, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted) setPreviewClient(detail);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setClientDetailsError(loadError(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setClientDetailsLoading(false);
      });
    return () => controller.abort();
  }, [clientDetailsRetry, initial, values.client]);

  function updateItem(index: number, field: keyof InvoiceItemInput, value: string) {
    setValues((current) => ({
      ...current,
      items: current.items.map((item, position) => (position === index ? { ...item, [field]: value } : item)),
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;

    const invalid: Record<string, string> = {};
    if (!values.client) invalid.client = 'Choose a client.';
    if (initial && !values.seller.name.trim()) invalid.seller = 'Enter a seller name.';
    values.items.forEach((item, index) => {
      if (!item.description.trim()) invalid[`item-${index}-description`] = 'Enter a description.';
      const quantity = scaled(item.quantity, 3);
      const price = scaled(item.unit_price, 4);
      const rate = scaled(item.tax_rate, 4);
      if (quantity === null || quantity <= 0n) {
        invalid[`item-${index}-quantity`] = 'Enter a positive quantity with at most 3 decimal places.';
      }
      if (price === null) {
        invalid[`item-${index}-unit_price`] = 'Enter a non-negative price with at most 4 decimal places.';
      }
      if (rate === null || rate > 1000000n) {
        invalid[`item-${index}-tax_rate`] = 'Enter a tax rate from 0 to 100.';
      }
    });
    setErrors(invalid);
    setFailure('');
    if (Object.keys(invalid).length) return;

    setPending(true);
    onPending(true);
    try {
      const seller = initial ? cleanSeller(values.seller) : undefined;
      await onSave({
        ...values,
        seller,
        items: values.items.map((item) => ({ ...item, description: item.description.trim() })),
      });
    } catch (cause) {
      const fieldErrors: Record<string, string> = {};
      if (cause instanceof ApiError && cause.status === 400 && cause.details && typeof cause.details === 'object') {
        const details = cause.details as Record<string, unknown>;
        for (const field of ['client', 'deal', 'currency', 'due_date', 'payment_terms', 'seller', 'items']) {
          const value = details[field];
          if (field === 'items' && Array.isArray(value)) {
            value.forEach((entry, index) => {
              if (entry && typeof entry === 'object') {
                Object.entries(entry).forEach(([name, detail]) => {
                  fieldErrors[`item-${index}-${name}`] = message(detail);
                });
              }
            });
          } else if (field === 'seller' && value && typeof value === 'object' && !Array.isArray(value)) {
            Object.entries(value).forEach(([name, detail]) => {
              fieldErrors[`seller-${name}`] = message(detail);
            });
          } else {
            fieldErrors[field] = message(value);
          }
        }
      }
      setErrors(fieldErrors);
      const failureMessage = Object.values(fieldErrors).some(Boolean)
        ? 'Please correct the highlighted fields.'
        : cause instanceof Error
          ? cause.message
          : 'Unable to save the invoice.';
      setFailure(failureMessage);
    } finally {
      setPending(false);
      onPending(false);
    }
  }

  return (
    <form className="invoice-form" onSubmit={submit} noValidate>
      <div className="invoice-editor-grid">
        <div className="invoice-fields">
          <p className="muted">
            Drafts are shared with your company. Saved workspace and client bank details are added when the invoice is
            created. Totals are confirmed by the server.
          </p>
          <div className="invoice-field-grid">
            <div className="field">
              <label htmlFor={fieldId('client')}>Client</label>
              <select
                id={fieldId('client')}
                required
                value={values.client}
                disabled={pending}
                {...errorProps('client')}
                onChange={(event) => setValues({ ...values, client: event.target.value, deal: null })}
              >
                <option value="">Select client</option>
                {clients.map((client) => (
                  <option value={client.id} key={client.id}>
                    {client.name}
                    {client.company ? ` · ${client.company}` : ''}
                  </option>
                ))}
              </select>
              {errors.client && (
                <p id={`${fieldId('client')}-error`} className="field-error">
                  {errors.client}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor={fieldId('currency')}>Currency</label>
              <select
                id={fieldId('currency')}
                value={values.currency}
                disabled={pending}
                {...errorProps('currency')}
                onChange={(event) => setValues({ ...values, currency: event.target.value })}
              >
                {invoiceCurrencies.map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
              {errors.currency && (
                <p id={`${fieldId('currency')}-error`} className="field-error">
                  {errors.currency}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor={fieldId('deal')}>Deal (optional)</label>
              <select
                id={fieldId('deal')}
                value={values.deal ?? ''}
                disabled={pending || !values.client || Boolean(dealError)}
                {...errorProps('deal')}
                onChange={(event) => setValues({ ...values, deal: event.target.value || null })}
              >
                <option value="">No linked deal</option>
                {deals
                  .filter((deal) => deal.client === values.client)
                  .map((deal) => (
                    <option value={deal.id} key={deal.id}>
                      {deal.title}
                    </option>
                  ))}
              </select>
              {dealError && <p className="field-error">Deals are unavailable: {dealError}</p>}
              {errors.deal && (
                <p id={`${fieldId('deal')}-error`} className="field-error">
                  {errors.deal}
                </p>
              )}
            </div>
          </div>
          <div className="invoice-field-grid">
            <div className="field">
              <label htmlFor={fieldId('due_date')}>Due date</label>
              <DateInput
                id={fieldId('due_date')}
                value={values.due_date ?? ''}
                disabled={pending}
                aria-invalid={Boolean(errors.due_date)}
                aria-describedby={errors.due_date ? `${fieldId('due_date')}-error` : undefined}
                onChange={(due_date) => setValues({ ...values, due_date: due_date || null })}
              />
              {errors.due_date && (
                <p id={`${fieldId('due_date')}-error`} className="field-error">
                  {errors.due_date}
                </p>
              )}
              <small className="muted">If blank, the due date is 30 days after issue.</small>
            </div>
            <div className="field">
              <label htmlFor={fieldId('payment_terms')}>Payment terms</label>
              <textarea
                id={fieldId('payment_terms')}
                value={values.payment_terms}
                maxLength={500}
                disabled={pending}
                {...errorProps('payment_terms')}
                onChange={(event) => setValues({ ...values, payment_terms: event.target.value })}
              />
              {errors.payment_terms && (
                <p id={`${fieldId('payment_terms')}-error`} className="field-error">
                  {errors.payment_terms}
                </p>
              )}
            </div>
          </div>
          <h3>Seller details</h3>
          {initial ? (
            <div className="invoice-field-grid">
              {(['name', 'email', 'phone', 'address', 'tax_id'] as const).map((field) => {
                const errorKey = `seller-${field}`;
                const error = errors[errorKey] || (field === 'name' ? errors.seller : '');
                return (
                  <div className="field" key={field}>
                    <label htmlFor={fieldId(field)}>
                      {{ name: 'Name', email: 'Email', phone: 'Phone', address: 'Address', tax_id: 'Tax ID' }[field]}
                    </label>
                    <input
                      id={fieldId(field)}
                      value={values.seller[field]}
                      maxLength={{ name: 200, email: 254, phone: 80, address: 500, tax_id: 100 }[field]}
                      disabled={pending}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? `${fieldId(field)}-error` : undefined}
                      onChange={(event) =>
                        setValues({ ...values, seller: { ...values.seller, [field]: event.target.value } })
                      }
                    />
                    {error && (
                      <p id={`${fieldId(field)}-error`} className="field-error">
                        {error}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted">The preview uses the saved workspace seller profile and payment details.</p>
          )}
          <div className="invoice-items-heading">
            <h3>Line items</h3>
            <button
              type="button"
              className="secondary"
              disabled={pending || values.items.length >= 100}
              onClick={() => setValues({ ...values, items: [...values.items, blankItem()] })}
            >
              + Add item
            </button>
          </div>
          {values.items.map((item, index) => (
            <div className="invoice-item-fields" key={index}>
              <div className="field">
                <label htmlFor={fieldId(`description-${index}`)}>Description</label>
                <input
                  id={fieldId(`description-${index}`)}
                  value={item.description}
                  maxLength={500}
                  disabled={pending}
                  {...errorProps(`item-${index}-description`)}
                  onChange={(event) => updateItem(index, 'description', event.target.value)}
                />
                {errors[`item-${index}-description`] && (
                  <p id={`${fieldId(`item-${index}-description`)}-error`} className="field-error">
                    {errors[`item-${index}-description`]}
                  </p>
                )}
              </div>
              <div className="invoice-item-numbers">
                {(['quantity', 'unit_price', 'tax_rate'] as const).map((field) => {
                  const errorKey = `item-${index}-${field}`;
                  return (
                    <div className="field" key={field}>
                      <label htmlFor={fieldId(`${field}-${index}`)}>
                        {{ quantity: 'Quantity', unit_price: 'Unit price', tax_rate: 'Tax %' }[field]}
                      </label>
                      <input
                        id={fieldId(`${field}-${index}`)}
                        type="number"
                        min="0"
                        step="any"
                        value={item[field]}
                        disabled={pending}
                        aria-invalid={Boolean(errors[errorKey])}
                        aria-describedby={errors[errorKey] ? `${fieldId(errorKey)}-error` : undefined}
                        onChange={(event) => updateItem(index, field, event.target.value)}
                      />
                      {errors[errorKey] && (
                        <p id={`${fieldId(errorKey)}-error`} className="field-error">
                          {errors[errorKey]}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              {values.items.length > 1 && (
                <button
                  type="button"
                  className="invoice-remove"
                  disabled={pending}
                  onClick={() =>
                    setValues({ ...values, items: values.items.filter((_, position) => position !== index) })
                  }
                >
                  Remove item {index + 1}
                </button>
              )}
            </div>
          ))}
        </div>
        <aside className="invoice-live-preview" aria-label="Invoice preview">
          {workspaceDetailsLoading && <p role="status">Loading saved workspace invoice details…</p>}
          {!initial && !isWorkspaceOwner && (
            <p role="status" className="muted">
              Only the workspace owner can preview saved seller and workspace bank details.
            </p>
          )}
          {workspaceDetailsError && (
            <div role="alert" className="notice error">
              <p>{workspaceDetailsError}</p>
              <div className="button-row">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setWorkspaceDetailsRetry((value) => value + 1)}
                  disabled={workspaceDetailsLoading}
                >
                  Retry loading workspace details
                </button>
                {workspaceNeedsSecurity && onOpenSecurity && (
                  <button type="button" className="text-action" onClick={onOpenSecurity}>
                    Open Security in a new tab
                  </button>
                )}
              </div>
            </div>
          )}
          {clientDetailsLoading && <p role="status">Loading saved client details…</p>}
          {clientDetailsError && (
            <div role="alert" className="notice error">
              <p>Unable to load the selected client’s full details: {clientDetailsError}</p>
              <button
                type="button"
                className="secondary"
                onClick={() => setClientDetailsRetry((value) => value + 1)}
                disabled={clientDetailsLoading}
              >
                Retry loading client details
              </button>
            </div>
          )}
          <InvoiceDocument
            invoiceNumber={initial?.invoice_number ?? 'New draft'}
            currency={values.currency}
            status="Draft"
            seller={
              initial
                ? { ...values.seller, bank_details: initial.seller_snapshot.bank_details }
                : sellerDetailsLoaded
                  ? { ...values.seller, bank_details: sellerBankDetails }
                  : {}
            }
            buyer={initial ? initial.buyer_snapshot : (detailedClient ?? selectedClient ?? {})}
            items={previewItems}
            issuedAt={initial?.issued_at ?? null}
            dueDate={values.due_date}
            paymentTerms={values.payment_terms}
            subtotal={totals?.subtotal ?? null}
            taxTotal={totals?.tax ?? null}
            total={totals?.total ?? null}
          />
        </aside>
      </div>
      {failure && (
        <p role="alert" className="notice error">
          {failure}
        </p>
      )}
      <footer className="dialog-actions">
        <button type="button" className="secondary" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save draft'}
        </button>
      </footer>
    </form>
  );
}
