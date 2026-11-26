import { useEffect, useRef, useState } from 'react';
import ActionIcon from './ActionIcon';
import NavIcon from './NavIcon';

type Page = 'Dashboard' | 'Deals' | 'Clients' | 'Tasks' | 'Invoices' | 'Activity' | 'Operations' | 'Settings';

export default function QuickActions({
  page,
  onNewClient,
  onNewDeal,
  onNewInvoice,
  onNavigate,
}: {
  page: Page;
  onNewClient: () => void;
  onNewDeal: () => void;
  onNewInvoice: () => void;
  onNavigate: (page: Page) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const createRef = useRef<HTMLDivElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const showGlobalCreate = page === 'Tasks' || page === 'Activity' || page === 'Operations' || page === 'Settings';

  useEffect(() => {
    if (!createOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!createRef.current?.contains(event.target as Node)) setCreateOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCreateOpen(false);
        createButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [createOpen]);

  const runCreate = (action: () => void) => {
    setCreateOpen(false);
    action();
  };

  return (
    <div className="quick-actions" role="group" aria-label="Quick actions">
      {showGlobalCreate && (
        <div className="quick-create" ref={createRef}>
          <button
            ref={createButtonRef}
            className="primary"
            aria-expanded={createOpen}
            aria-controls="quick-create-menu"
            onClick={() => setCreateOpen((open) => !open)}
          >
            <ActionIcon name="add" />
            Create
          </button>
          {createOpen && (
            <div id="quick-create-menu" className="quick-create-menu" role="group" aria-label="Create">
              <button onClick={() => runCreate(onNewClient)}>Client</button>
              <button onClick={() => runCreate(onNewDeal)}>Deal</button>
              <button onClick={() => runCreate(onNewInvoice)}>Invoice</button>
            </div>
          )}
        </div>
      )}
      <div className="quick-context-actions" role="group" aria-label="Page actions">
        {page === 'Dashboard' && (
          <>
            <button className="secondary" onClick={onNewClient} data-dialog-fallback>
              <ActionIcon name="add" />
              New client
            </button>
            <button className="secondary" onClick={onNewInvoice}>
              <ActionIcon name="add" />
              Create invoice
            </button>
            <button className="primary" onClick={() => onNavigate('Deals')}>
              <NavIcon page="Deals" />
              Explore deals
            </button>
          </>
        )}
        {page === 'Deals' && (
          <>
            <button className="secondary" onClick={() => onNavigate('Clients')}>
              <NavIcon page="Clients" />
              View clients
            </button>
            <button className="secondary" onClick={onNewInvoice}>
              <ActionIcon name="add" />
              Create invoice
            </button>
            <button className="primary" onClick={onNewDeal} data-dialog-fallback>
              <ActionIcon name="add" />
              New deal
            </button>
          </>
        )}
        {page === 'Clients' && (
          <>
            <button className="secondary" onClick={() => onNavigate('Deals')}>
              <NavIcon page="Deals" />
              View deals
            </button>
            <button className="secondary" onClick={onNewInvoice}>
              <ActionIcon name="add" />
              Create invoice
            </button>
            <button className="primary" onClick={onNewClient} data-dialog-fallback>
              <ActionIcon name="add" />
              New client
            </button>
          </>
        )}
        {page === 'Invoices' && (
          <>
            <button className="secondary" onClick={() => onNavigate('Clients')}>
              <NavIcon page="Clients" />
              View clients
            </button>
            <button className="primary" onClick={onNewInvoice}>
              <ActionIcon name="add" />
              Create invoice
            </button>
          </>
        )}
        {page === 'Activity' && (
          <>
            <button className="secondary" onClick={() => onNavigate('Tasks')}>
              <NavIcon page="Tasks" />
              View tasks
            </button>
            <button className="secondary" onClick={() => onNavigate('Deals')}>
              <NavIcon page="Deals" />
              View deals
            </button>
          </>
        )}
        {page === 'Settings' && (
          <button className="secondary" onClick={onNewInvoice}>
            <ActionIcon name="add" />
            Create invoice
          </button>
        )}
      </div>
    </div>
  );
}
