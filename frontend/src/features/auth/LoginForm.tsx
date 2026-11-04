import { useState, type FormEvent } from 'react';
import { auth, type User } from '../../api/client';
import { AuthLink, PasswordField } from './fields';

export default function LoginForm({ onLogin }: { onLogin: (user: User) => void }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const fields = new FormData(event.currentTarget);
    setError('');
    setPending(true);
    try {
      onLogin(await auth.login(String(fields.get('username')), String(fields.get('password'))));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign in.');
    } finally {
      setPending(false);
    }
  }

  return <form onSubmit={submit} className="auth-form">
        <label className="field">Email or username
          <input name="username" autoComplete="username" required maxLength={254} disabled={pending} autoCapitalize="none" spellCheck={false} />
        </label>
        <PasswordField name="password" current disabled={pending} />
        {error && <p role="alert" className="field-error">{error}</p>}
        <button className="primary" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
        <AuthLink to="/forgot-password">Forgot password?</AuthLink>
        <p className="muted">New to Micro-CRM? <AuthLink to="/sign-up">Create an account</AuthLink></p>
      </form>;
}
