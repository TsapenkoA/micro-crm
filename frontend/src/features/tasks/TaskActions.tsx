import { useEffect, useRef, useState } from 'react';
import ClientSectionIcon from '../clients/ClientSectionIcon';
import type { Task } from './api';

export default function TaskActions({
  task,
  disabled,
  onEdit,
  onDelete,
}: {
  task: Task;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  function run(action: () => void) {
    setOpen(false);
    trigger.current?.focus();
    action();
  }

  return (
    <div
      className="task-actions-menu"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="task-more"
        aria-label={`Actions for ${task.title}`}
        aria-expanded={open}
        aria-controls={`task-actions-${task.id}`}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        ⋯
      </button>
      {open && (
        <div
          id={`task-actions-${task.id}`}
          className="task-actions-dropdown"
          role="group"
          aria-label={`Actions for ${task.title}`}
        >
          <button disabled={disabled} onClick={() => run(onEdit)}>
            <ClientSectionIcon name="edit" />
            Edit task
          </button>
          <button className="danger" disabled={disabled} onClick={() => run(onDelete)}>
            <ClientSectionIcon name="delete" />
            Delete task
          </button>
        </div>
      )}
    </div>
  );
}
