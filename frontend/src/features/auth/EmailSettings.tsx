import { useEffect, useRef, useState, type FormEvent } from 'react';
import { auth, type User } from '../../api/client';
import { fieldErrors } from './fields';

const changeToken = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('email_change_token');

export default function EmailSettings({
  user,
  recentAuth,
  onUserUpdated,
  onOpenSecurity,
}: {
  user: User;
  recentAuth: boolean;
  onUserUpdated?: (user: User) => void;
  onOpenSecurity: () => void;
}) {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const confirmed = useRef('');

  useEffect(() => {
    const token = changeToken();
    if (!token || confirmed.current === token) return;
    confirmed.current = token;
    setPending(true);
    auth
      .confirmEmailChange(token)
      .then((result) => {
        onUserUpdated?.(result.user);
        setMessage('Email address updated.');
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/settings`);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to confirm the new email address.'))
      .finally(() => setPending(false));
  }, [onUserUpdated]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    setMessage('');
    setFieldError('');
    try {
      const result = await auth.requestEmailChange(email.trim());
      setMessage(result.message);
      setEmail('');
    } catch (cause) {
      setFieldError(fieldErrors(cause).email ?? '');
      setError(cause instanceof Error ? cause.message : 'Unable to request the email change.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="account-settings-section">
      <h3>Email address</h3>
      <p className="muted">
        Current address: {user.email || 'Not provided'}. Confirm a new address before it replaces this one.
      </p>
      <form className="auth-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="profile-new-email">New email address</label>
          <input
            id="profile-new-email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
            value={email}
            disabled={pending || !recentAuth}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={!!fieldError}
          />
          {fieldError && <p className="field-error">{fieldError}</p>}
        </div>
        <button className="primary" disabled={pending || !recentAuth || !email.trim()}>
          {pending ? 'Saving…' : 'Send confirmation email'}
        </button>
      </form>
      {!recentAuth && (
        <p className="muted">
          Confirm your identity in Security before changing your email.{' '}
          <button className="text-action" onClick={onOpenSecurity}>
            Open Security
          </button>
        </p>
      )}
      {message && (
        <p role="status" className="notice success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </section>
  );
}
