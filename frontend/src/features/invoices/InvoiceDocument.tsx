import { bankFields } from '../../components/BankDetailsFields';
import { formatDate } from '../../utils/dates';
import { money } from './api';
import type { BankDetails } from '../../api/client';

type DocumentParty = {
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  address?: string;
  tax_id?: string;
  bank_details?: BankDetails;
};

export type InvoiceDocumentItem = {
  description: string;
  quantity: string;
  unit_price: string;
  tax_rate: string;
  line_total: string | null;
};

export default function InvoiceDocument({
  invoiceNumber,
  currency,
  status,
  seller,
  buyer,
  items,
  issuedAt,
  issuedOn,
  dueDate,
  dueDateFallback = '30 days after issue',
  paymentTerms,
  statusNote,
  subtotal,
  taxTotal,
  total,
}: {
  invoiceNumber: string;
  currency: string;
  status: string;
  seller: DocumentParty;
  buyer: DocumentParty;
  items: InvoiceDocumentItem[];
  issuedAt: string | null;
  issuedOn?: string | null;
  dueDate: string | null;
  dueDateFallback?: string;
  paymentTerms: string;
  statusNote?: string;
  subtotal: string | null;
  taxTotal: string | null;
  total: string | null;
}) {
  const sellerBankFields = seller.bank_details && bankFields.filter(([field]) => seller.bank_details?.[field]);
  const buyerBankFields = buyer.bank_details && bankFields.filter(([field]) => buyer.bank_details?.[field]);

  return (
    <article className="invoice-document" aria-label="Invoice document">
      <div className="invoice-document-top">
        <span>INVOICE</span>
        <strong>{invoiceNumber}</strong>
      </div>
      <div className="invoice-parties">
        <div>
          <small>FROM</small>
          <strong>{seller.name || 'Seller'}</strong>
          {seller.address && <span>{seller.address}</span>}
          {seller.email && <span>{seller.email}</span>}
          {seller.phone && <span>{seller.phone}</span>}
          {seller.tax_id && <span>Tax ID: {seller.tax_id}</span>}
        </div>
        <div>
          <small>BILL TO</small>
          <strong>{buyer.company || buyer.name || 'Choose a client'}</strong>
          {buyer.company && buyer.name && <span>{buyer.name}</span>}
          {buyer.email && <span>{buyer.email}</span>}
          {buyer.phone && <span>{buyer.phone}</span>}
        </div>
      </div>
      {sellerBankFields?.length || buyerBankFields?.length ? (
        <div className="invoice-parties invoice-bank-parties">
          <div>
            {sellerBankFields?.length ? (
              <>
                <small>PAYMENT TO</small>
                {sellerBankFields.map(([field, label]) => (
                  <span key={field}>
                    {label}: {seller.bank_details?.[field]}
                  </span>
                ))}
              </>
            ) : null}
          </div>
          <div>
            {buyerBankFields?.length ? (
              <>
                <small>PAYER BANK</small>
                {buyerBankFields.map(([field, label]) => (
                  <span key={field}>
                    {label}: {buyer.bank_details?.[field]}
                  </span>
                ))}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="invoice-document-meta">
        <span>Status: {status}</span>
        <span>Issued: {formatDate(issuedOn ?? issuedAt, 'Not issued')}</span>
        <span>Due: {formatDate(dueDate, dueDateFallback)}</span>
      </div>
      {paymentTerms && <p className="invoice-document-terms">Payment terms: {paymentTerms}</p>}
      {statusNote && <p className="invoice-document-terms">{statusNote}</p>}
      <div className="invoice-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Tax %</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${index}-${item.description}`}>
                <td>{item.description || '—'}</td>
                <td>{item.quantity || '—'}</td>
                <td>{item.unit_price ? money(item.unit_price, currency) : '—'}</td>
                <td>{item.tax_rate ? item.tax_rate.replace(/\.0+$/, '') : '—'}</td>
                <td>{item.line_total === null ? '—' : money(item.line_total, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="invoice-totals">
        <dt>Subtotal</dt>
        <dd>{subtotal === null ? '—' : money(subtotal, currency)}</dd>
        <dt>Tax</dt>
        <dd>{taxTotal === null ? '—' : money(taxTotal, currency)}</dd>
        <dt>Total</dt>
        <dd>
          <strong>{total === null ? '—' : money(total, currency)}</strong>
        </dd>
      </dl>
    </article>
  );
}
