import { useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError, workspace, type BankDetails } from '../../api/client';
import BankDetailsFields, { bankFields } from '../../components/BankDetailsFields';

export default function WorkspaceBankSettings({ onOpenSecurity }: { onOpenSecurity: () => void }) {
  const id = useId();
  const [details, setDetails] = useState<BankDetails>({});
  const [allowed, setAllowed] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [confirmIdentity, setConfirmIdentity] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    workspace.settings().then(settings => { if (active) setAllowed(settings.can_manage_members); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load workspace settings.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function reveal() {
    if (pending) return;
    setPending(true); setError(''); setMessage('');
    try {
      const value = await workspace.bankDetails();
      setDetails(value); setRevealed(true); setConfirmIdentity(false);
    } catch (cause) {
      setConfirmIdentity(cause instanceof ApiError && cause.status === 403);
      setError(cause instanceof ApiError && cause.status === 403
        ? 'Confirm your identity in Security, then return to reveal payment details.'
        : cause instanceof Error ? cause.message : 'Unable to load payment details.');
    } finally { setPending(false); }
  }

  function hide() {
    setDetails({}); setRevealed(false); setConfirmIdentity(false); setErrors({}); setError(''); setMessage('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError(''); setMessage(''); setErrors({});
    try {
      const saved = await workspace.saveBankDetails(details);
      setDetails(saved); setMessage('Bank details saved for your workspace. New invoices will use them.');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) {
        hide(); setConfirmIdentity(true);
        setError('Confirm your identity in Security, then return to reveal payment details.');
        return;
      }
      if (cause instanceof ApiError && cause.details && typeof cause.details === 'object') {
        const details = cause.details as Record<string, unknown>;
        setErrors(Object.fromEntries(bankFields.map(([field]) => [field, Array.isArray(details[field]) ? details[field].join(' ') : String(details[field] ?? '')])));
      }
      setError(cause instanceof Error ? cause.message : 'Unable to save bank details.');
    } finally { setPending(false); }
  }

  return <section className="account-settings-section"><h3>Payment details for invoices</h3>
    <p className="muted">Only the workspace owner can view and change saved payment details after confirming their identity. New invoices use them; existing invoices keep their original details.</p>
    {loading ? <p role="status">Loading payment access…</p> : allowed && revealed ? <form className="auth-form" onSubmit={save}>
      <BankDetailsFields id={id} value={details} onChange={setDetails} disabled={pending} errors={errors} />
      <div className="button-row"><button className="primary" disabled={pending}>{pending ? 'Saving…' : 'Save payment details'}</button><button type="button" className="secondary" disabled={pending} onClick={hide}>Hide details</button></div>
    </form> : allowed ? <button className="secondary" disabled={pending} onClick={reveal}>{pending ? 'Checking access…' : 'Reveal payment details'}</button> : !error && <p>Payment details are available to the workspace owner.</p>}
    {confirmIdentity && <button className="text-action" onClick={onOpenSecurity}>Confirm identity in Security</button>}
    {error && <p role="alert" className="notice error">{error}</p>}{message && <p role="status" className="notice success">{message}</p>}
  </section>;
}
