import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import Dialog from '../src/components/Dialog';

it.each(['together', 'outer first', 'inner first'])('restores scroll after multiple dialogs close: %s', (order) => {
  document.body.style.overflow = 'auto';
  const dialogs = (outer: boolean, inner: boolean) => (
    <>
      {outer && (
        <Dialog title="Details" onClose={vi.fn()}>
          Details content
        </Dialog>
      )}
      {inner && (
        <Dialog title="Delete" onClose={vi.fn()}>
          Confirm deletion
        </Dialog>
      )}
    </>
  );
  const view = render(dialogs(true, false));
  view.rerender(dialogs(true, true));
  expect(document.body.style.overflow).toBe('hidden');
  if (order !== 'together') {
    view.rerender(dialogs(order === 'inner first', order === 'outer first'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(document.body.style.overflow).toBe('hidden');
  }
  view.rerender(dialogs(false, false));
  expect(document.body.style.overflow).toBe('auto');
  document.body.style.overflow = '';
});
