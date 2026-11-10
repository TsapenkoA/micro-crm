import { useState, type FormEvent } from 'react';
import { type PreviewContent } from './data';
import { Icon, UserAvatar, type PreviewProfile, type PreviewTheme } from './PreviewParts';

function PreviewThemeSelect({ theme, onChange }: { theme: PreviewTheme; onChange: (theme: PreviewTheme) => void }) {
  return <div className="theme-switch" role="group" aria-label="Preview theme">{(['system', 'light', 'dark'] as const).map(mode => <button key={mode} type="button" className="theme-option" aria-label={`${mode[0].toUpperCase() + mode.slice(1)} theme`} aria-pressed={theme === mode} onClick={() => onChange(mode)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{mode === 'light' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></> : mode === 'dark' ? <path d="M20.9 13.3A9 9 0 0 1 10.7 3.1a9 9 0 1 0 10.2 10.2Z" /> : <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>}</svg></button>)}</div>;
}

export default function SettingsPreview({ profile, onProfile, workspaceName, onWorkspaceName, compact, onCompact, reducedMotion, onReducedMotion, defaultCurrency, onDefaultCurrency, theme, onTheme, onSaved }: {
  profile: PreviewProfile;
  onProfile: (profile: PreviewProfile) => void;
  workspaceName: string;
  onWorkspaceName: (name: string) => void;
  compact: boolean;
  onCompact: (value: boolean) => void;
  reducedMotion: boolean;
  onReducedMotion: (value: boolean) => void;
  defaultCurrency: string;
  onDefaultCurrency: (value: string) => void;
  theme: PreviewTheme;
  onTheme: (theme: PreviewTheme) => void;
  onSaved: (message: string) => void;
}) {
  const [tab, setTab] = useState<'Profile' | 'Appearance' | 'Workspace' | 'Preferences' | 'Security'>('Profile');
  const [draft, setDraft] = useState(profile);
  const [workspaceDraft, setWorkspaceDraft] = useState(workspaceName);
  const [avatarError, setAvatarError] = useState('');

  function uploadAvatar(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setAvatarError('Choose a PNG, JPEG or WebP image under 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onProfile({ ...profile, avatar: reader.result });
        setAvatarError('');
        onSaved('Preview avatar updated. Changes reset when you reload.');
      }
    };
    reader.onerror = () => setAvatarError('Could not read this image. Try another file.');
    reader.readAsDataURL(file);
  }

  return <div className="pv-settings-layout">
    <nav className="pv-settings-nav" aria-label="Settings sections">{(['Profile', 'Appearance', 'Workspace', 'Preferences', 'Security'] as const).map(item => <button key={item} className={tab === item ? 'active' : ''} aria-current={tab === item ? 'page' : undefined} onClick={() => setTab(item)}>{item}</button>)}</nav>
    <section className="pv-surface pv-settings-panel">
      {tab === 'Profile' && <><div className="pv-section-heading"><div><h2>Profile</h2><p>Choose how you appear in this workspace.</p></div><span className="pv-preview-tag">Sample account</span></div><div className="pv-settings-body"><div className="pv-profile-identity"><UserAvatar profile={profile} large /><div><strong>{profile.name}</strong><p>{profile.email}</p></div></div><div className="pv-avatar-actions"><label className="pv-button secondary">Change photo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => uploadAvatar(event.target.files?.[0])} /></label>{profile.avatar && <button className="pv-button secondary" onClick={() => { onProfile({ ...profile, avatar: '' }); onSaved('Preview avatar removed. Changes reset when you reload.'); }}>Remove photo</button>}<small>PNG, JPEG or WebP · up to 2 MB</small></div>{avatarError && <p className="pv-field-error" role="alert">{avatarError}</p>}<form onSubmit={event => { event.preventDefault(); onProfile({ ...draft, avatar: profile.avatar, name: draft.name.trim(), username: draft.username.trim(), email: draft.email.trim() }); onSaved('Preview profile updated. Changes reset when you reload.'); }}><div className="pv-settings-fields"><label className="pv-field">Display name<input required maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label className="pv-field">Username<input required maxLength={40} value={draft.username} onChange={event => setDraft({ ...draft, username: event.target.value })} /></label><label className="pv-field">Email address<input required type="email" value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value })} /></label></div><div className="pv-settings-actions"><button className="pv-button primary" type="submit">Save profile</button></div></form></div></>}
      {tab === 'Appearance' && <><div className="pv-section-heading"><div><h2>Appearance</h2><p>Set the tone and spacing of your workspace.</p></div></div><div className="pv-settings-body"><div className="pv-setting-row"><div><strong>Color theme</strong><p>Follow your device, or choose light or dark.</p></div><PreviewThemeSelect theme={theme} onChange={onTheme} /></div><div className="pv-theme-samples" aria-hidden="true"><div className="light"><i /><div><b /><b /><b /></div><span>Light</span></div><div className="dark"><i /><div><b /><b /><b /></div><span>Dark</span></div></div><label className="pv-setting-row"><span><strong>Compact layout</strong><small>Fit more information on the page.</small></span><input type="checkbox" checked={compact} onChange={event => onCompact(event.target.checked)} /></label><label className="pv-setting-row"><span><strong>Reduce motion</strong><small>Limit animation and hover movement.</small></span><input type="checkbox" checked={reducedMotion} onChange={event => onReducedMotion(event.target.checked)} /></label></div></>}
      {tab === 'Workspace' && <><div className="pv-section-heading"><div><h2>Workspace</h2><p>Preview your company identity.</p></div><span className="pv-preview-tag">Sample workspace</span></div><div className="pv-settings-body"><div className="pv-workspace"><span className="pv-workspace-mark">{workspaceName.charAt(0).toUpperCase()}</span><div><strong>{workspaceName}</strong><small>Shared space for your team</small></div></div><form onSubmit={event => { event.preventDefault(); onWorkspaceName(workspaceDraft.trim()); onSaved('Preview workspace updated. Changes reset when you reload.'); }}><label className="pv-field">Workspace name<input required maxLength={80} value={workspaceDraft} onChange={event => setWorkspaceDraft(event.target.value)} /></label><div className="pv-settings-actions"><button className="pv-button primary" type="submit">Save workspace</button></div></form><p className="muted">Clients, deals and invoices belong to this sample workspace in the preview.</p></div></>}
      {tab === 'Preferences' && <><div className="pv-section-heading"><div><h2>Preferences</h2><p>Choose how to explore sample deals.</p></div></div><div className="pv-settings-body"><label className="pv-setting-row"><span><strong>Default deals currency</strong><small>Sets the initial currency filter on the Deals page.</small></span><select aria-label="Default deals currency" value={defaultCurrency} onChange={event => onDefaultCurrency(event.target.value)}><option value="USD">USD</option><option value="EUR">EUR</option></select></label></div></>}
      {tab === 'Security' && <PreviewSecurity />}
    </section>
    <p className="pv-settings-footnote">Preview settings reset when you reload. They do not change your account.</p>
  </div>;
}

function PreviewSecurity() {
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const checks = [
    { label: 'At least 12 characters', valid: passwords.next.length >= 12 },
    { label: 'Uppercase and lowercase letters', valid: /[A-Z]/.test(passwords.next) && /[a-z]/.test(passwords.next) },
    { label: 'At least one number', valid: /\d/.test(passwords.next) },
  ];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setComplete(false);
    if (!checks.every(check => check.valid)) setError('Choose a stronger demo password.');
    else if (passwords.next === passwords.current) setError('Choose a new password different from the current one.');
    else if (passwords.next !== passwords.confirm) setError('The confirmation does not match.');
    else {
      setPasswords({ current: '', next: '', confirm: '' });
      setError('');
      setComplete(true);
    }
  }

  return <><div className="pv-section-heading"><div><h2>Password & security</h2><p>Explore how account protection works.</p></div><span className="pv-preview-tag">Demo only</span></div><div className="pv-settings-body">
    <div className="pv-settings-hint"><strong>Use made-up passwords only</strong><p>This preview does not check your real password or change your account. Nothing from this form is sent to the server.</p></div>
    <form className="pv-security-form" onSubmit={submit} autoComplete="off">
      <h3>Try changing a password</h3>
      <p className="muted">The form demonstrates password checks and clears its fields after a successful trial.</p>
      <label className="pv-field">Current demo password<input type={visible ? 'text' : 'password'} autoComplete="off" required maxLength={128} value={passwords.current} onChange={event => { setPasswords({ ...passwords, current: event.target.value }); setError(''); setComplete(false); }} /></label>
      <label className="pv-field">New demo password<input type={visible ? 'text' : 'password'} autoComplete="off" required maxLength={128} value={passwords.next} onChange={event => { setPasswords({ ...passwords, next: event.target.value }); setError(''); setComplete(false); }} /></label>
      <ul className="pv-password-checks">{checks.map(check => <li key={check.label} className={check.valid ? 'valid' : ''}><Icon name="check" />{check.label}</li>)}</ul>
      <label className="pv-field">Confirm new demo password<input type={visible ? 'text' : 'password'} autoComplete="off" required maxLength={128} value={passwords.confirm} onChange={event => { setPasswords({ ...passwords, confirm: event.target.value }); setError(''); setComplete(false); }} /></label>
      <label className="pv-show-passwords"><input type="checkbox" checked={visible} onChange={event => setVisible(event.target.checked)} />Show demo passwords</label>
      {error && <p className="pv-field-error" role="alert">{error}</p>}
      {complete && <p className="pv-security-success" role="status">Demo complete. No account password was changed.</p>}
      <div className="pv-settings-actions"><button className="pv-button primary" type="submit">Try password change</button></div>
    </form>
    <div className="pv-security-facts"><div><strong>Current password required</strong><p>Real password changes verify the existing password.</p></div><div><strong>Other sessions signed out</strong><p>A real password change keeps the current session and invalidates other sessions.</p></div><div><strong>Sign-in method protection</strong><p>The last usable sign-in method cannot be disconnected.</p></div></div>
  </div></>;
}

