import { useEffect, useState, type FormEvent } from 'react';
import { clients, type ClientAttachment, type HistoryPage } from './api';

export default function ClientAttachments({ clientId, collapsibleForm = false, onChanged }: { clientId: string; collapsibleForm?: boolean; onChanged?: () => void }) {
  const [data, setData] = useState<HistoryPage<ClientAttachment> | null>(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(!collapsibleForm);

  useEffect(() => { setPage(1); }, [clientId]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    clients.attachments(clientId, page, controller.signal)
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setError('Unable to load files.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [clientId, page, revision]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!file || busy) return;
    if (file.size > 5 * 1024 * 1024 || file.size === 0) { setError('Choose a file between 1 byte and 5 MB.'); return; }
    setBusy(true); setError('');
    try { await clients.addAttachment(clientId, file); setFile(null); form.reset(); setPage(1); setRevision(value => value + 1); if (collapsibleForm) setShowForm(false); onChanged?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to upload the file.'); }
    finally { setBusy(false); }
  }

  async function download(item: ClientAttachment) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/v1/clients/${encodeURIComponent(clientId)}/attachments/${encodeURIComponent(item.id)}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Unable to download the file.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = item.name; document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to download the file.'); }
    finally { setBusy(false); }
  }

  async function remove(item: ClientAttachment) {
    if (!window.confirm(`Delete ${item.name}?`)) return;
    setBusy(true); setError('');
    try { await clients.removeAttachment(clientId, item.id); setRevision(value => value + 1); onChanged?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to delete the file.'); }
    finally { setBusy(false); }
  }

  return <section aria-label="Client files"><div className="history-heading"><h3>Files {data && <span className="client-deal-count">{data.count}</span>}</h3>{collapsibleForm && <button className="text-action" onClick={() => setShowForm(value => !value)}>{showForm ? 'Cancel' : 'Add file'}</button>}</div><p className="muted">PDF, PNG, JPEG or WebP · up to 5 MB per file.</p>
    {loading ? <p role="status" className="muted">Loading files…</p> : data?.results.length ? <><ul className="client-file-list">{data.results.map(item => <li key={item.id}><button className="text-action" disabled={busy} onClick={() => void download(item)}>{item.name}</button><small className="muted">{Math.ceil(item.size / 1024)} KB</small><button className="text-action danger" disabled={busy} onClick={() => void remove(item)}>Delete</button></li>)}</ul><div className="history-pagination"><span className="muted">Page {page}</span><div className="button-row"><button className="secondary" disabled={!data.previous} onClick={() => setPage(value => value - 1)}>Previous</button><button className="secondary" disabled={!data.next} onClick={() => setPage(value => value + 1)}>Next</button></div></div></> : <p className="muted">No files attached yet.</p>}
    {showForm && <form className="history-form" onSubmit={upload}><div className="field"><label htmlFor="client-attachment">Add a file</label><input id="client-attachment" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={event => setFile(event.target.files?.[0] ?? null)} /></div><button className="primary" disabled={!file || busy}>{busy ? 'Uploading…' : 'Upload file'}</button></form>}
    {error && <p role="alert" className="notice error">{error}</p>}
  </section>;
}
