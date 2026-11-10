import type { BankDetails } from '../api/client';

export const bankFields = [
  ['account_holder', 'Account holder', 200],
  ['bank_name', 'Bank name', 200],
  ['iban', 'IBAN', 34],
  ['bic', 'BIC / SWIFT', 11],
  ['account_number', 'Account number', 80],
  ['routing_number', 'Routing number / sort code', 80],
  ['payment_instructions', 'Payment instructions', 500],
] as const;

export default function BankDetailsFields({ id, value, onChange, disabled, errors = {} }: {
  id: string; value: BankDetails; onChange: (value: BankDetails) => void; disabled: boolean; errors?: Record<string, string>;
}) {
  return <div className="bank-details-fields">{bankFields.map(([field, label, maxLength]) => <div className="field" key={field}>
    <label htmlFor={`${id}-${field}`}>{label}</label>
    <input id={`${id}-${field}`} value={value[field] ?? ''} maxLength={maxLength} disabled={disabled}
      autoComplete="off" aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `${id}-${field}-error` : undefined}
      onChange={event => onChange({ ...value, [field]: event.target.value })} />
    {errors[field] && <p id={`${id}-${field}-error`} className="field-error">{errors[field]}</p>}
  </div>)}</div>;
}
