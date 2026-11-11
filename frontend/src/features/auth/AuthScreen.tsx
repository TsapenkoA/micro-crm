import { useEffect, useState, type FormEvent } from 'react';
import { auth, type Provider, type User } from '../../api/client';
import ThemeSelect from '../../components/ThemeSelect';
import ProviderIcon from '../../components/ProviderIcon';
import LoginForm from './LoginForm';
import { AuthLink, fieldErrors, PasswordField } from './fields';

export const authPaths = ['/login', '/sign-up', '/verify-email', '/resend-verification', '/forgot-password', '/reset-password', '/oauth-result'];

export default function AuthScreen({ path, onLogin, notice = '' }: { path: string; onLogin: (user: User) => void; notice?: string }) {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [providerError, setProviderError] = useState('');
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const signup = path === '/sign-up';
  const forgot = path === '/forgot-password';
  const reset = path === '/reset-password';
  const verify = path === '/verify-email';
  const resend = path === '/resend-verification';
  const result = path === '/oauth-result';
  const titles = signup ? ['Create your account', 'Your own workspace, ready for your clients.'] : verify ? ['Verify your email', 'Confirm your address to create your workspace.'] : resend ? ['Resend verification', 'Enter the address you used to sign up.'] : forgot ? ['Reset your password', 'Enter your email to request a reset link.'] : reset ? ['Choose a new password', 'Use a strong password you have not used elsewhere.'] : result ? ['Sign-in result', 'Return to your account to continue.'] : ['Welcome back', 'Sign in to your MicroFlow workspace.'];
  const params = new URLSearchParams(window.location.search);
  const validReset = Boolean(params.get('uid') && params.get('token'));
  const validVerification = Boolean(params.get('token'));

  useEffect(() => {
    let active = true;
    auth.providers().then(data => { if (active) setProviders(data.providers); })
      .catch(() => { if (active) setProviderError('Unable to load sign-in providers. Refresh the page to retry.'); });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get('email') ?? '').trim();
    const username = String(data.get('username') ?? '').trim();
    const password = String(data.get('password') ?? '');
    const password_confirm = String(data.get('password_confirm') ?? '');
    const invalid: Record<string, string> = {};
    if (signup && (!username || !/^[\p{L}\p{N}_.+-]+$/u.test(username))) invalid.username = 'Use letters, numbers, and . + - _ only.';
    if (!reset && !verify && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid.email = 'Enter a valid email address.';
    if (!forgot && !resend && !verify && password.length < 8) invalid.password = 'Use at least 8 characters.';
    if (!forgot && !resend && !verify && password !== password_confirm) invalid.password_confirm = 'Passwords do not match.';
    setErrors(invalid); setError(''); setMessage('');
    if (Object.keys(invalid).length) { form.querySelector<HTMLInputElement>(`[name="${Object.keys(invalid)[0]}"]`)?.focus(); return; }
    setPending(true);
    try {
      if (signup) setMessage((await auth.signup(username, email, password, password_confirm)).message);
      else if (verify) onLogin(await auth.verifyEmail(params.get('token')!));
      else if (resend) setMessage((await auth.resendVerification(email)).message);
      else if (forgot) setMessage((await auth.forgotPassword(email)).message);
      else {
        const response = await auth.resetPassword({ uid: params.get('uid')!, token: params.get('token')!, password, password_confirm });
        setMessage(response.message);
        window.history.replaceState(null, '', '/reset-password');
      }
    } catch (cause) {
      setErrors(fieldErrors(cause));
      setError(cause instanceof Error ? cause.message : 'Unable to complete this request.');
    } finally { setPending(false); }
  }

  async function social(provider: string) {
    setPending(true); setError('');
    try { window.location.assign((await auth.startProvider(provider)).url); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to start sign-in.'); setPending(false); }
  }

  return <main className="auth-page"><section className="panel auth-card">
    <div className="auth-theme"><ThemeSelect icons /></div>
    <p className="auth-brand accent">MICROFLOW</p><h1>{titles[0]}</h1><p className="muted auth-description">{titles[1]}</p>
    {notice && <p role="alert" className="notice error">{notice}</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
    {errors.token && <p role="alert" className="field-error">{errors.token}</p>}
    {message ? <div role="status"><p>{message}</p>{signup && <AuthLink to="/resend-verification">Resend verification email</AuthLink>}<AuthLink to="/login">Back to sign in</AuthLink></div> : result ? <>
      <p role="alert">{params.get('status') === 'account' ? 'Sign in to your existing account, then connect this provider in Settings. Accounts are not merged by email.' : params.get('status') === 'reauthenticate' ? 'Please sign in again before connecting a provider.' : 'Provider sign-in could not be completed. Please try again.'}</p>
      <div className="button-row"><AuthLink to="/login">Back to sign in</AuthLink><AuthLink to="/#/settings">Account settings</AuthLink></div>
    </> : !signup && !forgot && !reset && !verify && !resend ? <LoginForm onLogin={onLogin} /> : reset && !validReset ? <p role="alert">This reset link is invalid. <AuthLink to="/forgot-password">Request a new link</AuthLink>.</p> : verify && !validVerification ? <p role="alert">This verification link is invalid. <AuthLink to="/resend-verification">Request a new link</AuthLink>.</p> : <form onSubmit={submit} noValidate className="auth-form">
      {signup && <div className="field"><label htmlFor="auth-username">Username</label><input id="auth-username" name="username" autoComplete="username" required maxLength={150} disabled={pending} autoCapitalize="none" spellCheck={false} aria-invalid={!!errors.username} aria-describedby={errors.username ? 'auth-username-error' : undefined} />
        {errors.username && <p id="auth-username-error" className="field-error">{errors.username}</p>}</div>}
      {!reset && !verify && <div className="field"><label htmlFor="auth-email">Email</label><input id="auth-email" type="email" name="email" autoComplete="email" required maxLength={254} disabled={pending} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'auth-email-error' : undefined} />
        {errors.email && <p id="auth-email-error" className="field-error">{errors.email}</p>}</div>}
      {!forgot && !resend && !verify && <><PasswordField name="password" disabled={pending} error={errors.password} /><PasswordField name="password_confirm" label="Confirm password" disabled={pending} error={errors.password_confirm} /></>}
      <button className="primary" disabled={pending}>{pending ? 'Saving…' : signup ? 'Create account' : resend ? 'Resend email' : verify ? 'Verify email' : forgot ? 'Send reset link' : 'Save new password'}</button>
      <AuthLink to="/login">Back to sign in</AuthLink>
    </form>}
    {!message && (signup || (!forgot && !reset && !result && !verify && !resend)) && <div className="social-providers"><p className="muted">Or continue with</p>
      {providerError ? <p role="alert">{providerError}</p> : !providers ? <p role="status">Loading providers…</p> : providers.map(provider => <button key={provider.id} className="secondary provider-button" disabled={pending || !provider.configured} onClick={() => social(provider.id)}>
        <ProviderIcon provider={provider.id} /><span>{provider.name}{!provider.configured && ' · Not configured'}</span></button>)}
    </div>}
  </section></main>;
}
