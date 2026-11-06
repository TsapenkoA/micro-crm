import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import DashboardPage from '../src/features/dashboard/DashboardPage';
import { dashboard, type DashboardData } from '../src/features/dashboard/api';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null, CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null,
}));
vi.mock('../src/features/dashboard/api', () => ({ dashboard: { get: vi.fn() } }));

const data: DashboardData = {
  currency: 'USD', period: 'month', start: '2026-01-01T00:00:00Z', end: '2027-01-01T00:00:00Z',
  pipeline_value: '120.00', win_rate: '50.00', average_deal_size: '30.00', revenue: '75.25',
  revenue_rows: [{ period: '2026-12', revenue: '75.25' }],
  deal_counts: [{ status: 'new_lead', count: 1 }],
  recent_deals: [{ id: 'one', title: 'Website', client__name: 'Client', client__company: 'Studio', status: 'new_lead', deadline: null, amount: '120.00' }],
};

beforeEach(() => { vi.resetAllMocks(); vi.mocked(dashboard.get).mockResolvedValue(data); });

it('renders server KPIs and requests new data when filters change', async () => {
  render(<DashboardPage onNavigate={vi.fn()} />);
  expect(await screen.findByText('$75.25')).toBeInTheDocument();
  expect(screen.getByText('50%')).toBeInTheDocument();
  expect(screen.getByText('Website')).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Dashboard currency'), 'EUR');
  await waitFor(() => expect(dashboard.get).toHaveBeenCalledWith('EUR', 'month', expect.any(AbortSignal)));
  await userEvent.click(screen.getByRole('button', { name: 'Quarterly' }));
  await waitFor(() => expect(dashboard.get).toHaveBeenCalledWith('EUR', 'quarter', expect.any(AbortSignal)));
});

it('shows empty values and offers retry after an API failure', async () => {
  vi.mocked(dashboard.get).mockResolvedValueOnce({ ...data, win_rate: null, average_deal_size: null, revenue: '0.00', revenue_rows: [{ period: '2026-12', revenue: '0.00' }], recent_deals: [] });
  render(<DashboardPage onNavigate={vi.fn()} />);
  expect(await screen.findByText('No paid invoices in this period and currency.')).toBeInTheDocument();
  expect(screen.getAllByText('N/A')).toHaveLength(2);
  vi.mocked(dashboard.get).mockRejectedValueOnce(new Error('Network unavailable'));
  await userEvent.click(screen.getByRole('button', { name: 'Monthly' }));
  await userEvent.click(screen.getByRole('button', { name: 'Quarterly' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('$75.25')).toBeInTheDocument();
});
