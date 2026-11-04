import { useEffect, useState, type FormEvent } from 'react';
import { auth, type Provider, type SignInMethods, type User } from '../../api/client';
import Dialog from '../../components/Dialog';
import ThemeSelect from '../../components/ThemeSelect';
import ProviderIcon from '../../components/ProviderIcon';
import { fieldErrors, PasswordField } from './fields';

export default function AccountSettings({ user, onUserUpdated }: { user: User; onUserUpdated?: (user: User) => void }) {
  const [username, setUsername] = useState(user.username);
  const [methods, setMethods] = useState<SignInMethods | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [disconnect, setDisconnect] = useState<Provider | null>(null);

  async function load() {
    const [current, configured] = await Promise.all([auth.methods(), auth.providers()]);
    setMethods(current); setProviders(configured.providers);
  }
  useEffect(() => {
    let active = true;
    Promise.all([auth.methods(), auth.providers()]).then(([current, configured]) => { if (active) { setMethods(current); setProviders(configured.providers); } })
      .catch(() => { if (active) setError('Unable to load sign-in methods. Please retry.'); });
    return () => { active = false; };
  }, []);

  async function run(action: () => Promise<unknown>, success: string) {
    if (pending) return;
    setPending(true); setError(''); setErrors({}); setMessage('');
    try { await action(); setMessage(success); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update your account.'); setErrors(fieldErrors(cause)); }
    finally { setPending(false); }
  }

  async function password(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get('password'));
    const password_confirm = String(data.get('password_confirm'));
    if (password !== password_confirm) { setErrors({ password_confirm: 'Passwords do not match.' }); return; }
    await run(async () => { await auth.changePassword({ current_password: String(data.get('current_password') ?? ''), password, password_confirm }); form.reset(); }, 'Password updated.');
  }

  async function providerLogin(provider: Provider, process: 'login' | 'connect') {
    await run(async () => window.location.assign((await auth.startProvider(provider.id, process)).url), '');
  }

  return <section className="panel account-settings"><h2>Account</h2>
    <dl className="contact-list"><dt>Username</dt><dd>{user.username}</dd><dt>Email</dt><dd>{user.email || 'Not provided'}</dd><dt>Workspace</dt><dd>{user.workspace?.name || 'Workspace unavailable'}</dd></dl>
    <section><h3>Profile</h3><form className="auth-form" onSubmit={event => {
      event.preventDefault();
      run(async () => { const result = await auth.updateProfile(username.trim()); setUsername(result.user.username); onUserUpdated?.(result.user); }, 'Username updated.');
    }}><div className="field"><label htmlFor="profile-username">Username</label>
      <input id="profile-username" name="username" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" maxLength={150} required disabled={pending} aria-invalid={!!errors.username} aria-describedby={errors.username ? 'profile-username-error' : undefined} />
      {errors.username && <p id="profile-username-error" className="field-error">{errors.username}</p>}</div>
      <button className="secondary" disabled={pending || username.trim() === user.username}>Save username</button>
    </form></section>
    <section><h3>Appearance</h3><ThemeSelect /></section>
    {error && <p role="alert" className="notice error">{error}</p>}{message && <p role="status" className="notice success">{message}</p>}
    {!methods ? <>{!error && <p role="status">Loading sign-in methods…</p>}{error && <button className="secondary" onClick={() => run(load, '')} disabled={pending}>Retry</button>}</> : <>
      <section><h3>Sign-in methods</h3><p className="muted">Password: {methods.password ? 'Enabled' : 'Not set'}</p>
        <ul className="account-providers">{providers.map(provider => {
          const connected = methods.providers.includes(provider.id);
          return <li key={provider.id}><div><strong className="provider-identity"><ProviderIcon provider={provider.id} />{provider.name}</strong><p className="muted">{connected ? 'Connected' : provider.configured ? 'Available' : 'Not configured'}</p></div>
            <button className="secondary" disabled={pending || !methods.recent_auth || (!connected && !provider.configured) || (connected && !methods.password && methods.providers.length === 1)} onClick={() => connected ? setDisconnect(provider) : providerLogin(provider, 'connect')}>{connected ? `Disconnect ${provider.name}` : `Connect ${provider.name}`}</button></li>;
        })}</ul>
        <p className="muted">Keep at least one sign-in method. Connecting or disconnecting a provider requires a recent sign-in.</p>
        <button className="text-action" disabled={pending} onClick={() => run(load, '')}>Refresh sign-in methods</button>
      </section>
      {!methods.recent_auth && <section><h3>Confirm your identity</h3>{methods.password ? <form className="auth-form" onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget; const value = String(new FormData(form).get('verification_password'));
        run(async () => { await auth.reauthenticate(value); form.reset(); }, 'Identity confirmed.');
      }}><PasswordField name="verification_password" label="Verification password" current disabled={pending} /><button className="secondary" disabled={pending}>Confirm identity</button></form> : providers.filter(provider => methods.providers.includes(provider.id)).map(provider => <button key={provider.id} className="secondary" disabled={pending || !provider.configured} onClick={() => providerLogin(provider, 'login')}>Sign in again with {provider.name}</button>)}</section>}
      <section><h3>{methods.password ? 'Change password' : 'Set a password'}</h3>
        <form className="auth-form" onSubmit={password}>
          {methods.password && <PasswordField name="current_password" label="Current password" current disabled={pending} error={errors.current_password} />}
          <PasswordField name="password" label="New password" disabled={pending} error={errors.password} />
          <PasswordField name="password_confirm" label="Confirm new password" disabled={pending} error={errors.password_confirm} />
          <button className="primary" disabled={pending || (!methods.password && !methods.recent_auth)}>{pending ? 'Saving…' : 'Save password'}</button>
        </form>
      </section>
    </>}
    {disconnect && <Dialog title="Disconnect sign-in method" busy={pending} onClose={() => setDisconnect(null)}><div className="dialog-body"><p>Disconnect {disconnect.name} from your account?</p><div className="dialog-actions">
      <button className="secondary" disabled={pending} onClick={() => setDisconnect(null)} data-autofocus>Cancel</button><button className="primary destructive" disabled={pending} onClick={() => run(async () => { await auth.disconnect(disconnect.id); setDisconnect(null); }, 'Sign-in method disconnected.')}>Confirm disconnect</button>
    </div></div></Dialog>}
  </section>;
}
