import './InvoiceStatus.css';

export default function InvoiceStatus({ status, overdue = false }: { status: string; overdue?: boolean }) {
  const value = overdue ? 'overdue' : status;
  return <span className={`invoice-state invoice-state-${value}`}><i aria-hidden="true" />{value.charAt(0).toUpperCase() + value.slice(1)}</span>;
}
