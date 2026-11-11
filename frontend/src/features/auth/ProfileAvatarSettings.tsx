import { useState, type FormEvent } from 'react';
import { auth, type User } from '../../api/client';
import { fieldErrors } from './fields';

export default function ProfileAvatarSettings({ user, onUserUpdated }: { user: User; onUserUpdated?: (user: User) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem('avatar') as HTMLInputElement;
    if (!file || pending) return;
    if (file.size > 2 * 1024 * 1024) { setError('Choose an image under 2 MB.'); return; }
    setPending(true); setError(''); setMessage('');
    try {
      const result = await auth.uploadAvatar(file);
      onUserUpdated?.(result.user);
      setFile(null);
      input.value = '';
      setMessage('Profile photo updated.');
    } catch (cause) { setError(fieldErrors(cause).avatar ?? (cause instanceof Error ? cause.message : 'Unable to upload the photo.')); }
    finally { setPending(false); }
  }

  async function remove() {
    if (pending) return;
    setPending(true); setError(''); setMessage('');
    try { onUserUpdated?.((await auth.removeAvatar()).user); setMessage('Profile photo removed.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to remove the photo.'); }
    finally { setPending(false); }
  }

  return <section className="account-settings-section"><h3>Profile photo</h3>
    <p className="muted">Upload a JPEG, PNG or WebP image under 2 MB. It is resized for your account.</p>
    <form className="auth-form" onSubmit={upload}><div className="field"><label htmlFor="profile-avatar">Photo</label><input id="profile-avatar" name="avatar" type="file" accept="image/jpeg,image/png,image/webp" disabled={pending} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(''); }} /></div>
      <div className="button-row"><button className="primary" disabled={pending || !file}>{pending ? 'Saving…' : 'Save photo'}</button>{user.avatar_url && <button type="button" className="secondary" disabled={pending} onClick={remove}>Remove photo</button>}</div>
    </form>{error && <p role="alert" className="notice error">{error}</p>}{message && <p role="status" className="notice success">{message}</p>}
  </section>;
}
