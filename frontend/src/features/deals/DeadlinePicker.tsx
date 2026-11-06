import { useRef, useState } from 'react';

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad = (value: number) => String(value).padStart(2, '0');
const localValue = (day: Date, hour: string, minute: string) => `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T${hour}:${minute}`;

export default function DeadlinePicker({ value, onChange, disabled, invalid, describedBy }: { value: string; onChange: (value: string) => void; disabled: boolean; invalid: boolean; describedBy?: string }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => { const day = value ? new Date(value) : new Date(); return new Date(day.getFullYear(), day.getMonth(), 1); });
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = value ? new Date(value) : null;
  const hour = value ? value.slice(11, 13) : '12';
  const minute = value ? value.slice(14, 16) : '00';
  const start = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index - start + 1));
  const label = selected ? `${months[selected.getMonth()]} ${selected.getDate()}, ${selected.getFullYear()} · ${hour}:${minute}` : 'Choose a deadline';

  function moveMonth(step: number) { setMonth(current => new Date(current.getFullYear(), current.getMonth() + step, 1)); }
  function choose(day: Date) { onChange(localValue(day, hour, minute)); setMonth(new Date(day.getFullYear(), day.getMonth(), 1)); }
  function changeTime(nextHour: string, nextMinute: string) { onChange(localValue(selected ?? new Date(), nextHour, nextMinute)); }
  function close() { setOpen(false); trigger.current?.focus(); }

  return <div className="deal-deadline-picker" onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <button ref={trigger} type="button" className="deal-deadline-trigger" aria-label="Deadline (local time)" aria-haspopup="dialog" aria-expanded={open} aria-invalid={invalid} aria-describedby={describedBy} disabled={disabled} onClick={() => setOpen(current => !current)}>{label}<span aria-hidden="true">▦</span></button>
    {open && <div className="deal-calendar" role="dialog" aria-label="Choose deadline">
      <div className="deal-calendar-heading"><button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)}>‹</button><strong>{months[month.getMonth()]} {month.getFullYear()}</strong><button type="button" aria-label="Next month" onClick={() => moveMonth(1)}>›</button></div>
      <div className="deal-calendar-grid">{weekdays.map(day => <span key={day} className="deal-calendar-weekday">{day}</span>)}{days.map(day => {
        const date = localValue(day, hour, minute);
        const sameMonth = day.getMonth() === month.getMonth();
        const isSelected = value.slice(0, 10) === date.slice(0, 10);
        return <button type="button" key={date} className={`${sameMonth ? '' : 'outside-month'} ${isSelected ? 'selected' : ''}`} aria-label={day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} aria-pressed={isSelected} onClick={() => choose(day)}>{day.getDate()}</button>;
      })}</div>
      <div className="deal-calendar-time"><label>Hour<select aria-label="Deadline hour" value={hour} onChange={event => changeTime(event.target.value, minute)}>{Array.from({ length: 24 }, (_, index) => pad(index)).map(item => <option key={item}>{item}</option>)}</select></label><label>Minute<select aria-label="Deadline minute" value={minute} onChange={event => changeTime(hour, event.target.value)}>{Array.from({ length: 60 }, (_, index) => pad(index)).map(item => <option key={item}>{item}</option>)}</select></label></div>
      <div className="deal-calendar-actions"><button type="button" onClick={() => { choose(new Date()); }}>Today</button><button type="button" onClick={() => { onChange(''); close(); }}>Clear</button><button type="button" onClick={close}>Done</button></div>
    </div>}
  </div>;
}
