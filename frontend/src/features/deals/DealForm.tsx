import { useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import type { Client } from '../clients/api';
import { deals, errorMessage, stages, type Deal, type DealInput, type Outcome, type Status } from './api';
import DeadlinePicker from './DeadlinePicker';

function localDate(value: string | null) {
  if (!value) return '';
  const parsed = new Date(value);
  return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function DealForm({ initial, clients, onSaved, onCancel, onPending }: { initial?: Deal; clients: Client[]; onSaved: (deal: Deal) => void; onCancel: () => void; onPending: (pending: boolean) => void }) {
  const [values, setValues] = useState({ title: initial?.title ?? '', client: initial?.client ?? '', amount: initial?.amount.replace(/\.00$/, '') ?? '', currency: initial?.currency ?? 'USD', status: initial?.status ?? 'new_lead' as Status, outcome: initial?.outcome ?? 'none' as Outcome, deadline: localDate(initial?.deadline ?? null) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<Deal | null>(null);
  const [reloading, setReloading] = useState(false);

  function field(name: keyof typeof values, value: string) { setValues(current => ({ ...current, [name]: value })); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || conflict) return;
    const invalid: Record<string, string> = {};
    if (!values.title.trim()) invalid.title = 'Enter a deal title.';
    if (!values.client) invalid.client = 'Select a client.';
    if (!/^\d{1,16}(\.\d{1,2})?$/.test(values.amount)) invalid.amount = 'Use a nonnegative amount with up to two decimal places.';
    if (!/^[A-Z]{3}$/.test(values.currency)) invalid.currency = 'Use a three-letter uppercase currency code.';
    if (values.deadline && !Number.isFinite(new Date(values.deadline).getTime())) invalid.deadline = 'Enter a valid deadline.';
    setErrors(invalid); setError('');
    if (Object.keys(invalid).length) return;
    const payload: DealInput = { ...values, title: values.title.trim(), outcome: values.status === 'archived' ? values.outcome : 'none', deadline: values.deadline ? new Date(values.deadline).toISOString() : null };
    setSaving(true); onPending(true);
    try { onSaved(initial ? await deals.update(initial, payload) : await deals.create(payload)); }
    catch (cause) {
      setError(errorMessage(cause));
      if (cause instanceof ApiError && cause.status === 409) setConflict(true);
      if (cause instanceof ApiError && cause.status === 400 && cause.details && typeof cause.details === 'object') {
        setErrors(Object.fromEntries(Object.entries(cause.details).map(([key, value]) => [key, Array.isArray(value) ? value.join(' ') : String(value)])));
      }
    } finally { setSaving(false); onPending(false); }
  }
  async function reload() {
    if (!initial) return;
    setReloading(true);
    try { setLatest(await deals.detail(initial.id)); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setReloading(false); }
  }
  const labels = { title: 'Deal title', client: 'Client', amount: 'Amount', currency: 'Currency', status: 'Status', outcome: 'Archive outcome', deadline: 'Deadline (local time)' };
  const input = (name: keyof typeof values) => ({ name, value: values[name], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => field(name, event.target.value), 'aria-label': labels[name], 'aria-invalid': Boolean(errors[name]), 'aria-describedby': errors[name] ? `deal-error-${name}` : undefined });
  const problem = (name: string) => errors[name] && <span className="field-error" id={`deal-error-${name}`}>{errors[name]}</span>;
  return <form className="client-form live-deal-form" onSubmit={submit} noValidate>
    <p className="muted">Shared with your company. Changes are saved to your workspace.</p>
    {error && <p role="alert" className="notice error">{error}</p>}
    {conflict && <div className="deal-conflict"><p>Your unsaved values are kept below. Load the latest record to compare before discarding your draft.</p><button className="secondary" type="button" disabled={reloading} onClick={reload}>{reloading ? 'Loading…' : 'Reload current'}</button>{latest && <div><strong>Latest server record · version {latest.version}</strong><p>{latest.title} · {latest.amount} {latest.currency} · {latest.status.replaceAll('_', ' ')}</p><button className="secondary" type="button" onClick={() => onSaved(latest)}>Discard draft and open latest</button></div>}</div>}
    {!clients.length && <p role="alert">Create a client before adding a deal.</p>}
    <label className="field">Deal title<input {...input('title')} maxLength={250} required data-autofocus />{problem('title')}</label>
    <label className="field">Client<select {...input('client')} required><option value="">Select a client</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}{client.company ? ` · ${client.company}` : ''}</option>)}</select>{problem('client')}</label>
    <div className="deal-form-row"><label className="field">Amount<input {...input('amount')} inputMode="decimal" required placeholder="0.00" />{problem('amount')}</label><label className="field">Currency<input {...input('currency')} maxLength={3} required list="deal-currencies" /><datalist id="deal-currencies"><option>USD</option><option>EUR</option><option>GBP</option><option>UAH</option></datalist>{problem('currency')}</label></div>
    <div className="deal-form-row"><label className="field">Status<select {...input('status')}>{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select>{problem('status')}</label><div className="field"><span>Deadline (local time)</span><DeadlinePicker value={values.deadline} onChange={value => field('deadline', value)} disabled={saving} invalid={Boolean(errors.deadline)} describedBy={errors.deadline ? 'deal-error-deadline' : undefined} />{problem('deadline')}</div></div>
    {values.status === 'archived' && <label className="field">Archive outcome<select {...input('outcome')}><option value="none">None</option><option value="lost">Lost</option><option value="cancelled">Cancelled</option></select>{problem('outcome')}</label>}
    <div className="dialog-actions"><button className="secondary" type="button" disabled={saving} onClick={onCancel}>Cancel</button><button className="primary" disabled={saving || conflict || !clients.length}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Create deal'}</button></div>
  </form>;
}
