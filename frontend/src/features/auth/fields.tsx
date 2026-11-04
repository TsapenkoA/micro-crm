import { useId, useState, type ReactNode } from 'react';
import { ApiError } from '../../api/client';

export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== 'object') return {};
  return Object.fromEntries(Object.entries(error.details).map(([key, value]) => [key, Array.isArray(value) ? value.filter(item => typeof item === 'string').join(' ') : typeof value === 'string' ? value : '']));
}

export function PasswordField({ name, label = 'Password', current = false, error, disabled = false }: {
  name: string; label?: string; current?: boolean; error?: string; disabled?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return <div className="field"><label htmlFor={id}>{label}</label>
    <div className="password-control"><input id={id} name={name} type={visible ? 'text' : 'password'} required maxLength={4096}
      autoComplete={current ? 'current-password' : 'new-password'} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />
      <button type="button" className="secondary" aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-pressed={visible} disabled={disabled} onClick={() => setVisible(value => !value)}>{visible ? 'Hide' : 'Show'}</button></div>
    {error && <p id={`${id}-error`} className="field-error">{error}</p>}
  </div>;
}

export function navigateAuth(path: string, replace = false) {
  window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function AuthLink({ to, children }: { to: string; children: ReactNode }) {
  return <a href={to} onClick={event => {
    if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigateAuth(to); }
  }}>{children}</a>;
}
