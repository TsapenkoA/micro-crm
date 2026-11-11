import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, workspace, type User, type WorkspaceSettings } from '../../api/client';
import { fieldErrors } from './fields';

export default function WorkspaceIdentitySettings({ user, onUserUpdated, onOpenSecurity }: { user: User; onUserUpdated?: (user: User) => void; onOpenSecurity: () => void }) {
  const [details, setDetails] = useState<WorkspaceSettings | null>(null);
  const [name, setName] = useState(user.workspace?.name ?? '');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [message, setMessage] = useState('');
  const [username, setUsername] = useState('');
  const [memberPending, setMemberPending] = useState(false);
  const [memberError, setMemberError] = useState('');
  const [memberMessage, setMemberMessage] = useState('');

  useEffect(() => {
    let active = true;
    workspace.settings().then(value => { if (active) { setDetails(value); setName(value.name); } })
      .catch(() => { if (active) setError('Unable to load workspace settings. Please retry.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError(''); setFieldError(''); setMessage('');
    try {
      const result = await workspace.rename(name.trim());
      setName(result.name);
      setDetails(previous => previous ? { ...previous, name: result.name } : previous);
      onUserUpdated?.({ ...user, workspace: { id: result.id, name: result.name } });
      setMessage('Workspace name updated. Colleagues will see it after refreshing.');
    } catch (cause) {
      setFieldError(fieldErrors(cause).name ?? '');
      setError(cause instanceof Error ? cause.message : 'Unable to update the workspace.');
    } finally { setPending(false); }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (memberPending || !username.trim()) return;
    setMemberPending(true); setMemberError(''); setMemberMessage('');
    try {
      const result = await workspace.addMember(username.trim());
      setDetails(previous => previous ? { ...previous, members: previous.members.some(member => member.id === result.member.id) ? previous.members : [...previous.members, result.member] } : previous);
      setUsername('');
      setMemberMessage(`${result.member.username} can now access this workspace.`);
    } catch (cause) {
      setMemberError(cause instanceof ApiError && cause.status === 409
        ? 'This account cannot be added. It must have an empty personal workspace.'
        : cause instanceof ApiError && cause.status === 403
          ? 'Confirm your identity in Security before adding a member.'
          : cause instanceof Error ? cause.message : 'Unable to add the member.');
    } finally { setMemberPending(false); }
  }

  if (loading) return <p role="status">Loading workspace…</p>;
  if (!details) return <div><p role="alert">{error}</p><button className="secondary" onClick={() => window.location.reload()}>Retry</button></div>;
  return <section className="account-settings-section">
    <h3>Workspace name</h3>
    <p className="muted">Members of this workspace share its clients, deals and invoices.</p>
    <form className="auth-form" onSubmit={save}><div className="field"><label htmlFor="workspace-name">Name</label>
      <input id="workspace-name" value={name} onChange={event => setName(event.target.value)} maxLength={200} required disabled={pending} aria-invalid={!!fieldError} aria-describedby={fieldError ? 'workspace-name-error' : undefined} />
      {fieldError && <p id="workspace-name-error" className="field-error">{fieldError}</p>}
    </div><button className="primary" disabled={pending || !name.trim() || name.trim() === details.name}>{pending ? 'Saving…' : 'Save workspace name'}</button></form>
    {error && <p role="alert" className="notice error">{error}</p>}{message && <p role="status" className="notice success">{message}</p>}
    <div><h3>Members</h3><p className="muted">{details.members.length} {details.members.length === 1 ? 'person' : 'people'} in this workspace</p><ul className="account-member-list">{details.members.map(member => <li key={member.id}><strong>{member.name || member.username}{member.id === user.id ? ' (you)' : ''}</strong><small>{member.username}{member.email ? ` · ${member.email}` : ''}</small></li>)}</ul></div>
    {details.can_manage_members ? <div><h3>Add an existing account</h3><p className="muted">Enter the employee's username. Their personal workspace must contain no business records. Confirm your identity in Security before adding them.</p>
      <form className="auth-form" onSubmit={addMember}><div className="field"><label htmlFor="workspace-new-member">Username</label><input id="workspace-new-member" value={username} onChange={event => setUsername(event.target.value)} maxLength={150} required disabled={memberPending} autoComplete="off" /></div>
        <div className="button-row"><button className="primary" disabled={memberPending || !username.trim()}>{memberPending ? 'Adding…' : 'Add member'}</button><button type="button" className="secondary" onClick={onOpenSecurity}>Open Security</button></div>
      </form>{memberError && <p role="alert" className="notice error">{memberError}</p>}{memberMessage && <p role="status" className="notice success">{memberMessage}</p>}</div>
      : <p className="muted">Only the workspace owner can add members.</p>}
  </section>;
}
