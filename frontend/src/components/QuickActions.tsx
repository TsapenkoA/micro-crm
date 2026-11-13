import ActionIcon from './ActionIcon';
import NavIcon from './NavIcon';

type Page = 'Dashboard' | 'Deals' | 'Clients' | 'Tasks' | 'Invoices' | 'Activity' | 'Settings';

export default function QuickActions({ page, onNewClient, onNewDeal, onNewInvoice, onNavigate }: { page: Page; onNewClient: () => void; onNewDeal: () => void; onNewInvoice: () => void; onNavigate: (page: Page) => void }) {
  return <div className="quick-actions" role="group" aria-label="Page actions">
    {page === 'Dashboard' && <><button className="secondary" onClick={onNewClient} data-dialog-fallback><ActionIcon name="add" />New client</button><button className="secondary" onClick={onNewInvoice}><ActionIcon name="add" />Create invoice</button><button className="primary" onClick={() => onNavigate('Deals')}><NavIcon page="Deals" />Explore deals</button></>}
    {page === 'Deals' && <><button className="secondary" onClick={() => onNavigate('Clients')}><NavIcon page="Clients" />View clients</button><button className="secondary" onClick={onNewInvoice}><ActionIcon name="add" />Create invoice</button><button className="primary" onClick={onNewDeal} data-dialog-fallback><ActionIcon name="add" />New deal</button></>}
    {page === 'Clients' && <><button className="secondary" onClick={() => onNavigate('Deals')}><NavIcon page="Deals" />View deals</button><button className="secondary" onClick={onNewInvoice}><ActionIcon name="add" />Create invoice</button><button className="primary" onClick={onNewClient} data-dialog-fallback><ActionIcon name="add" />New client</button></>}
    {page === 'Tasks' && <><button className="secondary" onClick={() => onNavigate('Clients')}><NavIcon page="Clients" />View clients</button><button className="secondary" onClick={() => onNavigate('Deals')}><NavIcon page="Deals" />View deals</button></>}
    {page === 'Invoices' && <><button className="secondary" onClick={() => onNavigate('Clients')}><NavIcon page="Clients" />View clients</button><button className="primary" onClick={onNewInvoice}><ActionIcon name="add" />Create invoice</button></>}
    {page === 'Activity' && <><button className="secondary" onClick={() => onNavigate('Tasks')}><NavIcon page="Tasks" />View tasks</button><button className="secondary" onClick={() => onNavigate('Deals')}><NavIcon page="Deals" />View deals</button></>}
    {page === 'Settings' && <button className="secondary" onClick={onNewInvoice}><ActionIcon name="add" />Create invoice</button>}
  </div>;
}
