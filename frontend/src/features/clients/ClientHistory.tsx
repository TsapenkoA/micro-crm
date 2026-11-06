import { useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { clients, type ClientLink, type ClientNote, type HistoryPage } from './api';

type Kind = 'notes' | 'links';
type HistoryItem = ClientNote | ClientLink;

function externalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? value : undefined;
  } catch { return undefined; }
}

function HistorySection({ clientId, kind }: { clientId: string; kind: Kind }) {
  const [data, setData] = useState<HistoryPage<HistoryItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [destination, setDestination] = useState<number | 'latest'>(1);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const id = useId();
  const isNote = kind === 'notes';
  const title = isNote ? 'Notes & timeline' : 'Links';

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    async function load() {
      let requestedPage = destination === 'latest' ? 1 : destination;
      const fetchPage = (number: number) => isNote ? clients.notes(clientId, number, controller.signal) : clients.links(clientId, number, controller.signal);
      let result = await fetchPage(requestedPage);
      if (destination === 'latest' && result.next) {
        requestedPage = Math.ceil(result.count / 20);
        result = await fetchPage(requestedPage);
      }
      if (!controller.signal.aborted) { setData(result); setPage(requestedPage); }
    }
    load().catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : `Unable to load ${kind}.`);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [clientId, kind, isNote, destination, revision]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const fields: Record<string, string> = {};
    if (isNote && !text.trim()) fields.text = 'Enter a note.';
    if (!isNote) {
      if (!label.trim()) fields.label = 'Enter a link label.';
      if (!externalUrl(url.trim())) fields.url = 'Enter a complete http:// or https:// URL.';
    }
    setErrors(fields);
    setSubmitError('');
    setSuccess('');
    if (Object.keys(fields).length) {
      event.currentTarget.querySelector<HTMLElement>(`[name="${Object.keys(fields)[0]}"]`)?.focus();
      return;
    }
    setPending(true);
    try {
      if (isNote) { await clients.addNote(clientId, text.trim()); setText(''); }
      else { await clients.addLink(clientId, label.trim(), url.trim()); setLabel(''); setUrl(''); }
      setSuccess(isNote ? 'Note added.' : 'Link added.');
      setDestination('latest');
      setRevision(value => value + 1);
    } catch (cause) {
      const invalid: Record<string, string> = {};
      if (cause instanceof ApiError && cause.status === 400 && cause.details && typeof cause.details === 'object') {
        for (const key of ['text', 'label', 'url']) {
          const value = (cause.details as Record<string, unknown>)[key];
          if (typeof value === 'string') invalid[key] = value;
          else if (Array.isArray(value)) invalid[key] = value.filter(item => typeof item === 'string').join(' ');
        }
      }
      setErrors(invalid);
      setSubmitError(Object.keys(invalid).length ? 'Please correct the highlighted fields.' : cause instanceof Error ? cause.message : 'Unable to save.');
    } finally { setPending(false); }
  }

  async function removeNote(noteId: string) {
    if (deleting) return;
    setDeleting(true);
    setDeleteError('');
    setSuccess('');
    try {
      await clients.removeNote(clientId, noteId);
      setDeleteTarget(null);
      setSuccess('Note deleted.');
      setDestination('latest');
      setRevision(value => value + 1);
    } catch (cause) {
      setDeleteError(cause instanceof ApiError && cause.status === 403 ? 'Only the author can delete this note.'
        : cause instanceof Error ? cause.message : 'Unable to delete the note.');
    } finally { setDeleting(false); }
  }

  return <section aria-label={isNote ? 'Notes' : title} className="history-section">
    <div className="history-heading"><h3>{title}</h3><button className="text-action" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh {kind}</button></div>
    {isNote && <p className="history-description muted">Your team’s conversations and context, in one place.</p>}
    {loading ? <p role="status" className="muted">Loading {kind}…</p> : error ? <div><p role="alert" className="notice error">{error}</p>
      <button className="secondary" onClick={() => setRevision(value => value + 1)}>Retry {kind}</button></div>
      : data?.results.length ? <>
        <ol className={isNote ? 'note-timeline' : 'client-links'}>
          {data.results.map(item => <li key={item.id}>{'text' in item ? <>
            <p className="note-meta"><strong>{item.author.username}</strong><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</time></p>
            <p className="note-text">{item.text}</p>
            {item.can_delete && (deleteTarget === item.id ? <div className="note-delete-confirm" role="group" aria-label="Confirm note deletion">
              <p>Delete this note? This cannot be undone.</p>
              {deleteError && <p role="alert" className="field-error">{deleteError}</p>}
              <div className="button-row"><button className="secondary" autoFocus disabled={deleting} onClick={() => { setDeleteTarget(null); setDeleteError(''); }}>Cancel</button>
                <button className="primary destructive" disabled={deleting} onClick={() => removeNote(item.id)}>{deleting ? 'Deleting…' : 'Confirm deletion'}</button></div>
            </div> : <button className="text-action danger" disabled={deleting} onClick={() => { setDeleteTarget(item.id); setDeleteError(''); }}>Delete note</button>)}
          </> : <>{externalUrl(item.url) ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.label}</a> : <span>{item.label}</span>}
            <p className="muted link-url">{item.url}</p>{!externalUrl(item.url) && <p className="field-error">Unsupported link scheme. This link cannot be opened here.</p>}</>}</li>)}
        </ol>
        <div className="history-pagination"><span className="muted">{data.count} {kind} · Page {page}</span><div className="button-row">
          <button className="secondary" disabled={!data.previous} onClick={() => setDestination(page - 1)}>Previous {kind}</button>
          <button className="secondary" disabled={!data.next} onClick={() => setDestination(page + 1)}>Next {kind}</button>
        </div></div>
      </> : <p className="muted">{isNote ? 'No notes yet. Add the first update for your colleagues.' : 'No links yet. Add a brief, design, or repository URL.'}</p>}
    <form className="history-form" noValidate onSubmit={submit}>
      {isNote ? <div className="field"><label htmlFor={`${id}-text`}>New note</label>
        <textarea id={`${id}-text`} name="text" rows={3} maxLength={10000} required value={text} onChange={event => setText(event.target.value)} disabled={pending}
          aria-invalid={!!errors.text} aria-describedby={errors.text ? `${id}-text-error` : undefined} />
        {errors.text && <p className="field-error" id={`${id}-text-error`}>{errors.text}</p>}
      </div> : <>
        <div className="field"><label htmlFor={`${id}-label`}>Link label</label>
          <input id={`${id}-label`} name="label" value={label} maxLength={200} required onChange={event => setLabel(event.target.value)} disabled={pending}
            aria-invalid={!!errors.label} aria-describedby={errors.label ? `${id}-label-error` : undefined} />
          {errors.label && <p className="field-error" id={`${id}-label-error`}>{errors.label}</p>}
        </div>
        <div className="field"><label htmlFor={`${id}-url`}>Link URL</label>
          <input id={`${id}-url`} name="url" type="url" value={url} maxLength={2048} required onChange={event => setUrl(event.target.value)} disabled={pending}
            placeholder="https://example.com" aria-invalid={!!errors.url} aria-describedby={errors.url ? `${id}-url-error` : undefined} />
          {errors.url && <p className="field-error" id={`${id}-url-error`}>{errors.url}</p>}
        </div>
      </>}
      {success && <p role="status" className="notice success">{success}</p>}
      {submitError && <p role="alert" className="notice error">{submitError}</p>}
      <button className="primary" disabled={pending}>{pending ? 'Adding…' : isNote ? 'Add note' : 'Add link'}</button>
    </form>
  </section>;
}

export default function ClientHistory({ clientId }: { clientId: string }) {
  return <><HistorySection clientId={clientId} kind="notes" /><HistorySection clientId={clientId} kind="links" /></>;
}
