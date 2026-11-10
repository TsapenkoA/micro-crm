import { useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError, workspace, type BankDetails } from '../../api/client';
import BankDetailsFields, { bankFields } from '../../components/BankDetailsFields';

export default function WorkspaceBankSettings() {
  const id = useId();
  const [details, setDetails] = useState<BankDetails>({});
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    workspace.bankDetails().then(value => { if (active) setDetails(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load bank details.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError(''); setMessage(''); setErrors({});
    try {
      const saved = await workspace.saveBankDetails(details);
      setDetails(saved); setMessage('Bank details saved for your workspace. New invoices will use them.');
    } catch (cause) {
      if (cause instanceof ApiError && cause.details && typeof cause.details === 'object') {
        const details = cause.details as Record<string, unknown>;
        setErrors(Object.fromEntries(bankFields.map(([field]) => [field, Array.isArray(details[field]) ? details[field].join(' ') : String(details[field] ?? '')])));
      }
      setError(cause instanceof Error ? cause.message : 'Unable to save bank details.');
    } finally { setPending(false); }
  }

  return <section className="account-settings-section"><h3>Payment details for invoices</h3>
    <p className="muted">Shared by this workspace. Saved details are copied into new invoices; existing invoices keep their original details.</p>
    {loading ? <p role="status">Loading bank details…</p> : <form className="auth-form" onSubmit={save}>
      <BankDetailsFields id={id} value={details} onChange={setDetails} disabled={pending} errors={errors} />
      <button className="primary" disabled={pending}>{pending ? 'Saving…' : 'Save payment details'}</button>
    </form>}
    {error && <p role="alert" className="notice error">{error}</p>}{message && <p role="status" className="notice success">{message}</p>}
  </section>;
}
