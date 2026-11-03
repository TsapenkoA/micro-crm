import { useEffect, useId, useRef, type ReactNode } from 'react';

type Props = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  drawer?: boolean;
  role?: 'dialog' | 'alertdialog';
};

export default function Dialog({ title, children, onClose, busy = false, drawer = false, role = 'dialog' }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const trigger = document.activeElement;
    const dialog = ref.current!;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.querySelector<HTMLElement>('button'))?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
      else document.querySelector<HTMLElement>('[data-dialog-fallback]')?.focus();
    };
  }, []);

  return <dialog ref={ref} className={drawer ? 'dialog drawer' : 'dialog'} role={role} aria-modal="true" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); if (!busy) onClose(); }
      if (event.key === 'Tab') {
        const controls = Array.from(ref.current!.querySelectorAll<HTMLElement>('*')).filter(element =>
          element.matches('button, input, textarea, a[href], [tabindex]') && element.tabIndex >= 0 && !element.matches(':disabled, [hidden], input[type="hidden"]'));
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <header className="dialog-header"><h2 id={titleId}>{title}</h2>
      <button className="secondary" onClick={onClose} disabled={busy} aria-label="Close">×</button>
    </header>
    {children}
  </dialog>;
}
