import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import Dialog from '../../components/Dialog';
import ClientDetails from './ClientDetails';
import ClientForm from './ClientForm';
import DeleteClientDialog from './DeleteClientDialog';
import { clients, type Client, type ClientPage } from './api';

type Panel = { kind: 'create' } | { kind: 'detail'; id: string } | { kind: 'edit'; client: Client } | { kind: 'delete'; client: Client } | null;

export default function ClientsPage({ createRequested = false, onCreateHandled }: { createRequested?: boolean; onCreateHandled?: () => void }) {
  const [data, setData] = useState<ClientPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (createRequested) { setPanel({ kind: 'create' }); onCreateHandled?.(); }
  }, [createRequested, onCreateHandled]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    clients.list(search, page, controller.signal).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(cause => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 404 && page > 1) setPage(value => value - 1);
        else setError(cause instanceof Error ? cause.message : 'Unable to load clients.');
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [search, page, revision]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSearch(draft.trim());
    setPage(1);
    setRevision(value => value + 1);
  }

  function saved(message: string) {
    setPanel(null);
    setSuccess(message);
    setRevision(value => value + 1);
  }

  return <>
    <section aria-label="Company clients" className="panel clients-panel">
      <div className="clients-toolbar">
        <form role="search" onSubmit={submitSearch} className="client-search">
          <label className="sr-only" htmlFor="client-search">Search clients</label>
          <input id="client-search" type="search" placeholder="Search name, company or email" value={draft} onChange={event => setDraft(event.target.value)} />
          <button className="secondary">Search</button>
        </form>
        <div className="button-row"><button className="secondary" onClick={() => setRevision(value => value + 1)} disabled={loading}>Refresh</button>
          <button className="secondary" onClick={() => { setSuccess(''); setPanel({ kind: 'create' }); }}>Add client</button></div>
      </div>
      <p className="shared-caption muted">Shared with your company. Refresh to see your colleagues’ latest changes.</p>
      {success && <p role="status" className="notice success">{success}</p>}
      {loading ? <p role="status" className="empty-state muted">Loading clients…</p> : error ? <div className="empty-state"><p role="alert" className="notice error">{error}</p>
        <button className="secondary" onClick={() => setRevision(value => value + 1)}>Retry</button></div>
        : data && data.results.length ? <>
          <table className="client-table"><caption className="sr-only">Clients in your company workspace</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Company</th><th scope="col">Email</th><th scope="col">Phone</th><th scope="col">Actions</th></tr></thead>
            <tbody>{data.results.map(client => <tr key={client.id}>
              <th scope="row"><button className="client-name" onClick={() => setPanel({ kind: 'detail', id: client.id })}>{client.name}</button></th>
              <td data-label="Company">{client.company || '—'}</td><td data-label="Email">{client.email || '—'}</td><td data-label="Phone">{client.phone || '—'}</td>
              <td><div className="button-row"><button className="text-action" aria-label={`Edit ${client.name}`} onClick={() => setPanel({ kind: 'edit', client })}>Edit</button>
                <button className="text-action danger" aria-label={`Delete ${client.name}`} onClick={() => setPanel({ kind: 'delete', client })}>Delete</button></div></td>
            </tr>)}</tbody>
          </table>
          <footer className="pagination"><span className="muted">{data.count} {data.count === 1 ? 'client' : 'clients'} · Page {page}</span>
            <div className="button-row"><button className="secondary" disabled={!data.previous} onClick={() => setPage(value => value - 1)}>Previous</button>
              <button className="secondary" disabled={!data.next} onClick={() => setPage(value => value + 1)}>Next</button></div></footer>
        </> : <div className="empty-state"><span aria-hidden="true" className="empty-icon">◎</span><h2>{search ? 'No matching clients' : 'No clients yet'}</h2>
          <p className="muted">{search ? 'Try a different name, company or email.' : 'Add your first client to start building your company’s contact list.'}</p>
          {!search && <button className="primary" onClick={() => setPanel({ kind: 'create' })}>Add your first client</button>}
        </div>}
    </section>
    {panel?.kind === 'detail' && <Dialog key={panel.id} title="Client details" drawer onClose={() => setPanel(null)}>
      <ClientDetails id={panel.id} onEdit={client => setPanel({ kind: 'edit', client })} onDelete={client => setPanel({ kind: 'delete', client })} />
    </Dialog>}
    {(panel?.kind === 'create' || panel?.kind === 'edit') && <Dialog key={panel.kind} title={panel.kind === 'create' ? 'New client' : 'Edit client'} onClose={() => setPanel(null)} busy={saving}>
      <ClientForm initial={panel.kind === 'edit' ? panel.client : undefined} onCancel={() => setPanel(null)} onPending={setSaving}
        onSave={async values => {
          if (panel.kind === 'create') { await clients.create(values); setPage(1); saved('Client created.'); }
          else { await clients.update(panel.client.id, values); saved('Client updated.'); }
        }} />
    </Dialog>}
    {panel?.kind === 'delete' && <DeleteClientDialog client={panel.client} onClose={() => setPanel(null)} onDeleted={() => saved('Client deleted.')} />}
  </>;
}
