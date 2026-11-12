import { useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError, workspace, type SellerDetails } from '../../api/client';

const fields = [
  ['name', 'Seller or legal name', 200],
  ['email', 'Business email', 254],
  ['phone', 'Phone', 80],
  ['address', 'Business address', 500],
  ['tax_id', 'Tax ID', 100],
] as const;

const empty: SellerDetails = { name: '', email: '', phone: '', address: '', tax_id: '' };

export default function WorkspaceSellerSettings({ onOpenSecurity }: { onOpenSecurity: () => void }) {
  const id = useId();
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [details, setDetails] = useState<SellerDetails>(empty);
  const [pending, setPending] = useState(false);
  const [confirmIdentity, setConfirmIdentity] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    workspace.settings().then(settings => { if (active) setAllowed(settings.can_manage_members); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load seller profile access.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function hide() {
    setDetails(empty); setRevealed(false); setConfirmIdentity(false); setErrors({}); setError(''); setMessage('');
  }

  async function reveal() {
    setPending(true); setError(''); setMessage('');
    try {
      setDetails({ ...empty, ...await workspace.sellerDetails() });
      setRevealed(true); setConfirmIdentity(false);
    } catch (cause) {
      setConfirmIdentity(cause instanceof ApiError && cause.status === 403);
      setError(cause instanceof ApiError && cause.status === 403
        ? 'Confirm your identity in Security, then return to view the seller profile.'
        : cause instanceof Error ? cause.message : 'Unable to load the seller profile.');
    } finally { setPending(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setError(''); setMessage(''); setErrors({});
    try {
      const saved = await workspace.saveSellerDetails(details);
      setDetails({ ...empty, ...saved });
      setMessage('Seller profile saved. New invoice drafts will use these details.');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) {
        hide(); setConfirmIdentity(true);
        setError('Confirm your identity in Security, then return to view the seller profile.');
        return;
      }
      if (cause instanceof ApiError && cause.details && typeof cause.details === 'object') {
        const details = cause.details as Record<string, unknown>;
        setErrors(Object.fromEntries(fields.map(([field]) => [field, Array.isArray(details[field]) ? details[field].join(' ') : String(details[field] ?? '')])));
      }
      setError(cause instanceof Error ? cause.message : 'Unable to save the seller profile.');
    } finally { setPending(false); }
  }

  return <section className="account-settings-section"><h3>Seller profile for invoices</h3>
    <p className="muted">Only the workspace owner can view and update this profile after confirming their identity. New drafts use it; existing invoices keep their original seller details.</p>
    {loading ? <p role="status">Loading seller profile access…</p> : allowed && revealed ? <form className="auth-form" onSubmit={save}>
      {fields.map(([field, label, maxLength]) => <div className="field" key={field}><label htmlFor={`${id}-${field}`}>{label}</label><input id={`${id}-${field}`} type={field === 'email' ? 'email' : 'text'} value={details[field] ?? ''} maxLength={maxLength} required={field === 'name' || field === 'email'} disabled={pending} onChange={event => setDetails({ ...details, [field]: event.target.value })} />{errors[field] && <p className="field-error">{errors[field]}</p>}</div>)}
      <div className="button-row"><button className="primary" disabled={pending}>{pending ? 'Saving…' : 'Save seller profile'}</button><button type="button" className="secondary" disabled={pending} onClick={hide}>Hide profile</button></div>
    </form> : allowed ? <button className="secondary" disabled={pending} onClick={reveal}>{pending ? 'Checking access…' : 'Reveal seller profile'}</button> : !error && <p>The seller profile is available to the workspace owner.</p>}
    {confirmIdentity && <button className="text-action" onClick={onOpenSecurity}>Confirm identity in Security</button>}
    {error && <p role="alert" className="notice error">{error}</p>}{message && <p role="status" className="notice success">{message}</p>}
  </section>;
}
