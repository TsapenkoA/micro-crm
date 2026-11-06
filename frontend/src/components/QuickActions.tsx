type Page = 'Dashboard' | 'Deals' | 'Clients' | 'Invoices' | 'Settings';

export default function QuickActions({ page, onNewClient, onNewDeal, onNewInvoice, onNavigate }: { page: Page; onNewClient: () => void; onNewDeal: () => void; onNewInvoice: () => void; onNavigate: (page: Page) => void }) {
  return <div className="quick-actions" role="group" aria-label="Page actions">
    {page === 'Dashboard' && <><button className="secondary" onClick={onNewClient} data-dialog-fallback>+ New client</button><button className="secondary" onClick={onNewInvoice}>+ Create invoice</button><button className="primary" onClick={() => onNavigate('Deals')}>Explore deals →</button></>}
    {page === 'Deals' && <><button className="secondary" onClick={() => onNavigate('Clients')}>View clients →</button><button className="secondary" onClick={onNewInvoice}>+ Create invoice</button><button className="primary" onClick={onNewDeal} data-dialog-fallback>+ New deal</button></>}
    {page === 'Clients' && <><button className="secondary" onClick={() => onNavigate('Deals')}>View deals →</button><button className="secondary" onClick={onNewInvoice}>+ Create invoice</button><button className="primary" onClick={onNewClient} data-dialog-fallback>+ New client</button></>}
    {page === 'Invoices' && <><button className="secondary" onClick={() => onNavigate('Clients')}>View clients →</button><button className="primary" onClick={onNewInvoice}>+ Create invoice</button></>}
    {page === 'Settings' && <button className="secondary" onClick={onNewInvoice}>+ Create invoice</button>}
  </div>;
}
