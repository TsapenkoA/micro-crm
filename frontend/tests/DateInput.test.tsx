import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import DateInput from '../src/components/DateInput';
import { formatDate } from '../src/utils/dates';

it('shows an English calendar and keeps the selected date in API format', async () => {
  const change = vi.fn();
  render(<DateInput aria-label="Due date" defaultValue="2026-12-02" onChange={change} />);
  expect(screen.getByLabelText('Due date')).toHaveAttribute('type', 'text');
  await userEvent.click(screen.getByRole('button', { name: 'Choose Due date' }));
  expect(screen.getByText('December 2026')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'December 15, 2026' }));
  expect(change).toHaveBeenLastCalledWith('2026-12-15');
  expect(screen.getByLabelText('Due date')).toHaveValue('2026-12-15');
});

it('rejects impossible dates and out-of-range dates without changing time zones', () => {
  render(<DateInput aria-label="Due date" min="2026-01-01" max="2026-12-31" required />);
  const input = screen.getByLabelText('Due date');
  fireEvent.change(input, { target: { value: '2026-02-30' } });
  expect(input).toBeInvalid();
  fireEvent.change(input, { target: { value: '2027-01-01' } });
  expect(input).toBeInvalid();
  fireEvent.change(input, { target: { value: '2026-12-15' } });
  expect(input).toBeValid();
  expect(formatDate('2026-12-15')).toBe('Dec 15, 2026');
});

it('preserves local time when choosing another task date and closes on Escape', async () => {
  const change = vi.fn();
  render(<DateInput aria-label="Task due date" time defaultValue="2026-12-02T13:45" onChange={change} />);
  await userEvent.click(screen.getByRole('button', { name: 'Choose Task due date' }));
  await userEvent.click(screen.getByRole('button', { name: 'December 15, 2026' }));
  expect(change).toHaveBeenLastCalledWith('2026-12-15T13:45');
  await userEvent.click(screen.getByRole('button', { name: 'Choose Task due date' }));
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('group', { name: 'Calendar' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Choose Task due date' })).toHaveFocus();
});

it('commits only complete valid filter dates on blur', () => {
  const commit = vi.fn();
  render(<DateInput aria-label="Filter date" onCommit={commit} />);
  const input = screen.getByLabelText('Filter date');
  fireEvent.change(input, { target: { value: '2026-11-' } });
  fireEvent.blur(input);
  expect(commit).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '2026-11-18' } });
  expect(commit).not.toHaveBeenCalled();
  fireEvent.blur(input);
  expect(commit).toHaveBeenCalledWith('2026-11-18');
});
