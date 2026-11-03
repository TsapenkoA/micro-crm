import { useState } from 'react';
import { ApiError } from '../../api/client';
import Dialog from '../../components/Dialog';
import { clients, type Client } from './api';

export default function DeleteClientDialog({ client, onClose, onDeleted }: { client: Client; onClose: () => void; onDeleted: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    if (pending) return;
    setPending(true);
    setError('');
    try { await clients.remove(client.id); onDeleted(); }
    catch (cause) {
      setError(cause instanceof ApiError && cause.status === 409
        ? 'This client has linked records, such as invoices, deals, or notes, and cannot be deleted. The client and related records have been kept.'
        : cause instanceof Error ? cause.message : 'Unable to delete the client.');
    } finally { setPending(false); }
  }
  return <Dialog title="Delete client" role="alertdialog" onClose={onClose} busy={pending}>
    <div className="dialog-body"><p>Delete <strong>{client.name}</strong>? This action cannot be undone.</p>
      {error && <p role="alert" className="notice error">{error}</p>}
      <footer className="dialog-actions"><button className="secondary" onClick={onClose} disabled={pending} data-autofocus>Cancel</button>
        <button className="primary destructive" onClick={remove} disabled={pending}>{pending ? 'Deleting…' : 'Delete client'}</button></footer>
    </div>
  </Dialog>;
}
