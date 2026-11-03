export default function QuickActions({ onNewClient }: { onNewClient: () => void }) {
  return <div className="quick-actions" role="group" aria-label="Quick actions">
    <button className="primary" onClick={onNewClient} data-dialog-fallback>+ New client</button>
    <button className="secondary" disabled title="Deal creation is not available yet">+ New deal <small>Coming soon</small></button>
    <button className="secondary" disabled title="Invoice creation is not available yet">+ Create invoice <small>Coming soon</small></button>
  </div>;
}
