import { useId, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import type { Client } from '../clients/api';
import { currencyPlaces, invoiceCurrencies, money, type Invoice, type InvoiceInput, type InvoiceItemInput } from './api';

const blankItem = (): InvoiceItemInput => ({ description: '', quantity: '1', unit_price: '', tax_rate: '0' });

function scaled(value: string, digits: number) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > digits) return null;
  return BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0');
}

function estimate(items: InvoiceItemInput[], currency: string) {
  const places = currencyPlaces[currency as keyof typeof currencyPlaces];
  if (places === undefined) return null;
  const divisor = 10n ** BigInt(7 - places);
  const unit = 10n ** BigInt(places);
  let subtotal = 0n;
  let tax = 0n;
  for (const item of items) {
    const quantity = scaled(item.quantity, 3);
    const price = scaled(item.unit_price, 4);
    const rate = scaled(item.tax_rate, 4);
    if (quantity === null || price === null || rate === null) return null;
    const line = (quantity * price + divisor / 2n) / divisor;
    subtotal += line;
    tax += (line * rate + 500000n) / 1000000n;
  }
  const format = (value: bigint) => places ? `${value / unit}.${String(value % unit).padStart(places, '0')}` : String(value);
  return { subtotal: format(subtotal), tax: format(tax), total: format(subtotal + tax) };
}

function message(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(message).join(' ');
  return '';
}

export default function InvoiceForm({ clients, initial, workspaceName, userEmail, onSave, onCancel, onPending }: {
  clients: Client[]; initial?: Invoice; workspaceName: string; userEmail: string;
  onSave: (values: InvoiceInput) => Promise<void>; onCancel: () => void; onPending: (value: boolean) => void;
}) {
  const id = useId();
  const [values, setValues] = useState<InvoiceInput>({
    client: initial?.client ?? clients[0]?.id ?? '', currency: initial?.currency ?? 'USD',
    seller: { name: initial?.seller_snapshot.name ?? workspaceName, email: initial?.seller_snapshot.email ?? userEmail, address: initial?.seller_snapshot.address ?? '', tax_id: initial?.seller_snapshot.tax_id ?? '' },
    items: initial?.items.map(item => ({ description: item.description, quantity: item.quantity, unit_price: item.unit_price, tax_rate: item.tax_rate })) ?? [blankItem()],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  const [pending, setPending] = useState(false);
  const preview = estimate(values.items, values.currency);

  function updateItem(index: number, field: keyof InvoiceItemInput, value: string) {
    setValues(current => ({ ...current, items: current.items.map((item, position) => position === index ? { ...item, [field]: value } : item) }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const invalid: Record<string, string> = {};
    if (!values.client) invalid.client = 'Choose a client.';
    if (!values.seller.name.trim()) invalid.seller = 'Enter a seller name.';
    values.items.forEach((item, index) => {
      if (!item.description.trim()) invalid[`item-${index}-description`] = 'Enter a description.';
      const quantity = scaled(item.quantity, 3);
      const price = scaled(item.unit_price, 4);
      const rate = scaled(item.tax_rate, 4);
      if (quantity === null || quantity <= 0n) invalid[`item-${index}-quantity`] = 'Enter a positive quantity with at most 3 decimal places.';
      if (price === null) invalid[`item-${index}-unit_price`] = 'Enter a non-negative price with at most 4 decimal places.';
      if (rate === null || rate > 1000000n) invalid[`item-${index}-tax_rate`] = 'Enter a tax rate from 0 to 100.';
    });
    setErrors(invalid); setFailure('');
    if (Object.keys(invalid).length) return;
    setPending(true); onPending(true);
    try {
      await onSave({ ...values, seller: Object.fromEntries(Object.entries(values.seller).map(([key, value]) => [key, value.trim()])) as InvoiceInput['seller'], items: values.items.map(item => ({ ...item, description: item.description.trim() })) });
    } catch (cause) {
      const fieldErrors: Record<string, string> = {};
      if (cause instanceof ApiError && cause.status === 400 && cause.details && typeof cause.details === 'object') {
        const details = cause.details as Record<string, unknown>;
        for (const field of ['client', 'currency', 'seller', 'items']) {
          const value = details[field];
          if (field === 'items' && Array.isArray(value)) value.forEach((entry, index) => {
            if (entry && typeof entry === 'object') Object.entries(entry).forEach(([name, detail]) => { fieldErrors[`item-${index}-${name}`] = message(detail); });
          });
          else if (field === 'seller' && value && typeof value === 'object' && !Array.isArray(value)) Object.entries(value).forEach(([name, detail]) => { fieldErrors[`seller-${name}`] = message(detail); });
          else fieldErrors[field] = message(value);
        }
      }
      setErrors(fieldErrors);
      setFailure(Object.values(fieldErrors).some(Boolean) ? 'Please correct the highlighted fields.' : cause instanceof Error ? cause.message : 'Unable to save the invoice.');
    } finally { setPending(false); onPending(false); }
  }

  return <form className="invoice-form" onSubmit={submit} noValidate>
    <div className="invoice-editor-grid"><div className="invoice-fields"><p className="muted">Drafts are shared with your company. Totals are confirmed by the server when saved.</p>
      <div className="invoice-field-grid"><div className="field"><label htmlFor={`${id}-client`}>Client</label><select id={`${id}-client`} required value={values.client} disabled={pending} onChange={event => setValues({ ...values, client: event.target.value })}><option value="">Select client</option>{clients.map(client => <option value={client.id} key={client.id}>{client.name}{client.company ? ` · ${client.company}` : ''}</option>)}</select>{errors.client && <p className="field-error">{errors.client}</p>}</div><div className="field"><label htmlFor={`${id}-currency`}>Currency</label><select id={`${id}-currency`} value={values.currency} disabled={pending} onChange={event => setValues({ ...values, currency: event.target.value })}>{invoiceCurrencies.map(currency => <option key={currency}>{currency}</option>)}</select>{errors.currency && <p className="field-error">{errors.currency}</p>}</div></div>
      <h3>Seller details</h3><div className="invoice-field-grid">{(['name', 'email', 'address', 'tax_id'] as const).map(field => <div className="field" key={field}><label htmlFor={`${id}-${field}`}>{{ name: 'Name', email: 'Email', address: 'Address', tax_id: 'Tax ID' }[field]}</label><input id={`${id}-${field}`} value={values.seller[field]} maxLength={{ name: 200, email: 254, address: 500, tax_id: 100 }[field]} disabled={pending} onChange={event => setValues({ ...values, seller: { ...values.seller, [field]: event.target.value } })} />{(errors[`seller-${field}`] || (field === 'name' && errors.seller)) && <p className="field-error">{errors[`seller-${field}`] || errors.seller}</p>}</div>)}</div>
      <div className="invoice-items-heading"><h3>Line items</h3><button type="button" className="secondary" disabled={pending || values.items.length >= 100} onClick={() => setValues({ ...values, items: [...values.items, blankItem()] })}>+ Add item</button></div>
      {values.items.map((item, index) => <div className="invoice-item-fields" key={index}><div className="field"><label htmlFor={`${id}-description-${index}`}>Description</label><input id={`${id}-description-${index}`} value={item.description} maxLength={500} disabled={pending} onChange={event => updateItem(index, 'description', event.target.value)} />{errors[`item-${index}-description`] && <p className="field-error">{errors[`item-${index}-description`]}</p>}</div><div className="invoice-item-numbers">{(['quantity', 'unit_price', 'tax_rate'] as const).map(field => <div className="field" key={field}><label htmlFor={`${id}-${field}-${index}`}>{{ quantity: 'Quantity', unit_price: 'Unit price', tax_rate: 'Tax %' }[field]}</label><input id={`${id}-${field}-${index}`} type="number" min="0" step="any" value={item[field]} disabled={pending} onChange={event => updateItem(index, field, event.target.value)} />{errors[`item-${index}-${field}`] && <p className="field-error">{errors[`item-${index}-${field}`]}</p>}</div>)}</div>{values.items.length > 1 && <button type="button" className="invoice-remove" disabled={pending} onClick={() => setValues({ ...values, items: values.items.filter((_, position) => position !== index) })}>Remove item {index + 1}</button>}</div>)}
    </div><aside className="invoice-live-preview" aria-label="Invoice preview"><span className="invoice-eyebrow">INVOICE PREVIEW</span><h3>{initial?.invoice_number ?? 'New draft'}</h3><p>{values.seller.name || 'Seller'}</p><p className="muted">Bill to: {clients.find(client => client.id === values.client)?.name ?? 'Choose a client'}</p><hr /><dl><dt>Subtotal</dt><dd>{preview ? money(preview.subtotal, values.currency) : '—'}</dd><dt>Tax</dt><dd>{preview ? money(preview.tax, values.currency) : '—'}</dd><dt>Total</dt><dd><strong>{preview ? money(preview.total, values.currency) : '—'}</strong></dd></dl></aside></div>
    {failure && <p role="alert" className="notice error">{failure}</p>}
    <footer className="dialog-actions"><button type="button" className="secondary" disabled={pending} onClick={onCancel}>Cancel</button><button className="primary" disabled={pending}>{pending ? 'Saving…' : 'Save draft'}</button></footer>
  </form>;
}
