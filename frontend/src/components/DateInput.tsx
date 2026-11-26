import { useId, useRef, useState } from 'react';
import './date-input.css';

type Props = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onCommit?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  min?: string;
  max?: string;
  time?: boolean;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};
const pad = (value: number) => String(value).padStart(2, '0');
const dateValue = (day: Date) => `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;

export default function DateInput({ value, defaultValue = '', onChange, onCommit, time = false, ...props }: Props) {
  const [local, setLocal] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const current = value ?? local;
  const selected = new Date(current.length === 10 ? `${current}T00:00:00` : current);
  const [month, setMonth] = useState(() => {
    const day = Number.isNaN(selected.getTime()) ? new Date() : selected;
    return new Date(day.getFullYear(), day.getMonth(), 1);
  });
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const start = (month.getDay() + 6) % 7;
  const days = Array.from(
    { length: 42 },
    (_, index) => new Date(month.getFullYear(), month.getMonth(), index - start + 1),
  );

  function validate(next: string) {
    const day = new Date(`${next.slice(0, 10)}T00:00:00`);
    const valid =
      /^\d{4}-\d{2}-\d{2}$/.test(next.slice(0, 10)) &&
      !Number.isNaN(day.getTime()) &&
      dateValue(day) === next.slice(0, 10) &&
      (!time || /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(next));
    const inRange = (!props.min || next >= props.min) && (!props.max || next <= props.max);
    input.current?.setCustomValidity(
      !next || (valid && inRange)
        ? ''
        : `Enter a valid ${time ? 'date and time' : 'date'}${props.min || props.max ? ' within the allowed range' : ''}.`,
    );
    return !next || (valid && inRange);
  }
  function change(next: string) {
    setLocal(next);
    validate(next);
    onChange?.(next);
  }
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <span
      className="date-input"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <span className="date-input-control">
        <input
          {...props}
          ref={input}
          type="text"
          lang="en"
          autoComplete="off"
          value={current}
          placeholder={time ? 'YYYY-MM-DDTHH:mm' : 'YYYY-MM-DD'}
          pattern={time ? '\\d{4}-\\d{2}-\\d{2}T[0-2][0-9]:[0-5][0-9]' : '\\d{4}-\\d{2}-\\d{2}'}
          onChange={(event) => change(event.target.value)}
          onBlur={() => {
            if (validate(current)) onCommit?.(current);
          }}
        />
        <button
          ref={trigger}
          type="button"
          className="date-input-trigger"
          aria-label={`Choose ${props['aria-label'] || (time ? 'date and time' : 'date')}`}
          aria-expanded={open}
          aria-controls={id}
          disabled={props.disabled}
          onClick={() => {
            if (!Number.isNaN(selected.getTime())) setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
            setOpen((previous) => !previous);
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <path d="M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4" />
          </svg>
        </button>
      </span>
      {open && (
        <span className="date-input-calendar" id={id} role="group" aria-label="Calendar">
          <span className="date-input-heading">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
              ‹
            </button>
            <strong>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</strong>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            >
              ›
            </button>
          </span>
          <span className="date-input-grid">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <small key={day}>{day}</small>
            ))}
            {days.map((day) => {
              const date = dateValue(day);
              return (
                <button
                  key={date}
                  type="button"
                  aria-label={day.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  aria-pressed={current.slice(0, 10) === date}
                  className={day.getMonth() !== month.getMonth() ? 'outside-month' : ''}
                  disabled={
                    (!!props.min && date < props.min.slice(0, 10)) || (!!props.max && date > props.max.slice(0, 10))
                  }
                  onClick={() => {
                    const next = time ? `${date}T${current.slice(11, 16) || '12:00'}` : date;
                    change(next);
                    if (validate(next)) onCommit?.(next);
                    close();
                  }}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </span>
          <span className="date-input-actions">
            <button
              type="button"
              onClick={() => {
                change('');
                onCommit?.('');
                close();
              }}
            >
              Clear
            </button>
            <button type="button" onClick={close}>
              Done
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
