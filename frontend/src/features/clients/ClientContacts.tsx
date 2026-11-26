import { useEffect, useState, type FormEvent } from 'react';
import { clients, type ClientContact, type ClientContactInput } from './api';

const empty: ClientContactInput = { name: '', role: '', email: '', phone: '', is_primary: false };

export default function ClientContacts({
  clientId,
  onPrimaryChanged,
}: {
  clientId: string;
  onPrimaryChanged: () => void;
}) {
  const [records, setRecords] = useState<ClientContact[]>([]);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<ClientContactInput>(empty);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    clients
      .contacts(clientId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setRecords(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Unable to load contacts.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [clientId, revision]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    setError('');
    try {
      if (editing === 'new') await clients.addContact(clientId, form);
      else await clients.updateContact(clientId, editing, form);
      setEditing(null);
      setForm(empty);
      setRevision((value) => value + 1);
      onPrimaryChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the contact.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(contact: ClientContact) {
    if (!window.confirm(`Delete ${contact.name}?`)) return;
    setBusy(true);
    setError('');
    try {
      await clients.removeContact(clientId, contact.id);
      setRevision((value) => value + 1);
      onPrimaryChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete the contact.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Client contacts">
      <div className="history-heading">
        <h3>Contacts</h3>
        <button
          className="text-action"
          onClick={() => {
            setEditing('new');
            setForm(empty);
          }}
        >
          Add contact
        </button>
      </div>
      <p className="muted">The primary contact is used for new invoices.</p>
      {loading ? (
        <p role="status" className="muted">
          Loading contacts…
        </p>
      ) : records.length ? (
        <ul className="client-contact-list">
          {records.map((contact) => (
            <li key={contact.id}>
              <div>
                <strong>{contact.name}</strong> {contact.is_primary && <small>Primary</small>}
                {contact.role && <p className="muted">{contact.role}</p>}
                {contact.email && (
                  <p>
                    <a href={`mailto:${contact.email}`}>{contact.email}</a>
                  </p>
                )}
                {contact.phone && (
                  <p>
                    <a href={`tel:${contact.phone}`}>{contact.phone}</a>
                  </p>
                )}
              </div>
              <div className="button-row">
                <button
                  className="text-action"
                  onClick={() => {
                    setEditing(contact.id);
                    setForm({
                      name: contact.name,
                      role: contact.role,
                      email: contact.email,
                      phone: contact.phone,
                      is_primary: contact.is_primary,
                    });
                  }}
                >
                  Edit
                </button>
                {!contact.is_primary && (
                  <button className="text-action danger" disabled={busy} onClick={() => void remove(contact)}>
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No contacts yet.</p>
      )}
      {editing && (
        <form className="history-form" onSubmit={save}>
          <h4>{editing === 'new' ? 'New contact' : 'Edit contact'}</h4>
          <div className="field">
            <label>
              Name
              <input
                required
                maxLength={200}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
          </div>
          <div className="field">
            <label>
              Role
              <input
                maxLength={100}
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value })}
              />
            </label>
          </div>
          <div className="field">
            <label>
              Email
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </label>
          </div>
          <div className="field">
            <label>
              Phone
              <input
                maxLength={50}
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </label>
          </div>
          <label className="client-primary-choice">
            <input
              type="checkbox"
              checked={form.is_primary}
              onChange={(event) => setForm({ ...form, is_primary: event.target.checked })}
            />
            Primary contact
          </label>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save contact'}
            </button>
          </div>
        </form>
      )}
      {!editing && error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </section>
  );
}
