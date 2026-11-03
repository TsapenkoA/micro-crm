import { useId, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { type ClientInput } from './api';

const limits = { name: 200, company: 200, email: 254, phone: 50 };
const labels = { name: 'Name', company: 'Company', email: 'Email', phone: 'Phone' };
type FieldErrors = Partial<Record<keyof ClientInput, string>>;

export default function ClientForm({ initial, onSave, onCancel, onPending }: {
  initial?: ClientInput;
  onSave: (data: ClientInput) => Promise<void>;
  onCancel: () => void;
  onPending: (pending: boolean) => void;
}) {
  const [values, setValues] = useState<ClientInput>({ name: initial?.name ?? '', company: initial?.company ?? '', email: initial?.email ?? '', phone: initial?.phone ?? '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const id = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()])) as ClientInput;
    const invalid: FieldErrors = {};
    if (!data.name) invalid.name = 'Enter a client name.';
    if (data.email && !/^[^\s@]+@[^\s@]+$/.test(data.email)) invalid.email = 'Enter a valid email address.';
    for (const key of Object.keys(limits) as (keyof ClientInput)[]) {
      if (data[key].length > limits[key]) invalid[key] = `Use ${limits[key]} characters or fewer.`;
    }
    setErrors(invalid);
    setError('');
    if (Object.keys(invalid).length) {
      event.currentTarget.querySelector<HTMLInputElement>(`[name="${Object.keys(invalid)[0]}"]`)?.focus();
      return;
    }
    setPending(true);
    onPending(true);
    try {
      await onSave(data);
    } catch (cause) {
      const fields: FieldErrors = {};
      if (cause instanceof ApiError && cause.status === 400 && cause.details && typeof cause.details === 'object') {
        for (const key of Object.keys(limits) as (keyof ClientInput)[]) {
          const detail = (cause.details as Record<string, unknown>)[key];
          if (typeof detail === 'string') fields[key] = detail;
          else if (Array.isArray(detail)) fields[key] = detail.filter(value => typeof value === 'string').join(' ');
        }
      }
      setErrors(fields);
      setError(Object.keys(fields).length ? 'Please correct the highlighted fields.' : cause instanceof Error ? cause.message : 'Unable to save the client.');
    } finally {
      setPending(false);
      onPending(false);
    }
  }

  return <form onSubmit={submit} noValidate className="client-form">
    <p className="muted">Clients are shared with everyone in your company workspace.</p>
    {(Object.keys(limits) as (keyof ClientInput)[]).map(key => <div className="field" key={key}>
      <label htmlFor={`${id}-${key}`}>{labels[key]} {key !== 'name' && <span className="muted">(optional)</span>}</label>
      <input id={`${id}-${key}`} name={key} type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
        value={values[key]} onChange={event => setValues({ ...values, [key]: event.target.value })}
        maxLength={limits[key]} required={key === 'name'} disabled={pending} data-autofocus={key === 'name' ? '' : undefined}
        autoComplete={key === 'company' ? 'organization' : key === 'phone' ? 'tel' : key === 'name' ? 'name' : 'email'}
        aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${id}-${key}-error` : undefined} />
      {errors[key] && <p id={`${id}-${key}-error`} className="field-error">{errors[key]}</p>}
    </div>)}
    {error && <p role="alert" className="notice error">{error}</p>}
    <footer className="dialog-actions"><button type="button" className="secondary" disabled={pending} onClick={onCancel}>Cancel</button>
      <button className="primary" disabled={pending}>{pending ? 'Saving…' : 'Save client'}</button></footer>
  </form>;
}
