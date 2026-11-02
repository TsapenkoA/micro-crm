import { useState, type FormEvent } from 'react';
import { auth, type User } from '../../api/client';

export default function LoginForm({ onLogin }: { onLogin: (user: User) => void }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

  return <main className="grid min-h-screen place-items-center px-6">
    <section className="panel w-full max-w-md p-9">
      <p className="mb-8 text-sm font-bold tracking-widest text-indigo-600">MICRO / CRM</p>
      <h1 className="text-3xl font-semibold">Your workspace</h1>
      <p className="mt-3 mb-8 text-sm text-slate-500">Sign in to continue your work.</p>
      <form onSubmit={submit} className="grid gap-5">
        <label className="grid gap-2 text-sm">Username
          <input name="username" autoComplete="username" required maxLength={150} />
        </label>
        <label className="grid gap-2 text-sm">Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button className="primary" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </section>
  </main>;
}
