import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import DashboardPage from '../src/features/dashboard/DashboardPage';
import { dashboard, type DashboardData } from '../src/features/dashboard/api';
import { auth } from '../src/api/client';

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
  recent_deals: [{ id: 'one', title: 'Website', client__name: 'Client', client__company: 'Studio', status: 'new_lead', deadline: null, amount: '120.00', currency: 'GBP' }],
  fx: { source: 'ECB', pipeline_rate_date: '2026-12-01', average_rate_dates: ['2026-11-15'], revenue_rate_dates: ['2026-12-01'], missing: { pipeline: [], average_deal_size: [], revenue: [] } },
};

beforeEach(() => { vi.resetAllMocks(); vi.mocked(dashboard.get).mockResolvedValue(data); vi.spyOn(auth, 'updateReportingCurrency').mockImplementation(async reporting_currency => ({ reporting_currency })); });

it('renders server KPIs and requests new data when filters change', async () => {
  render(<DashboardPage onNavigate={vi.fn()} />);
  expect(await screen.findByText('$75.25')).toBeInTheDocument();
  expect(screen.getByText('50%')).toBeInTheDocument();
  expect(screen.getByText('Website')).toBeInTheDocument();
  expect(screen.getByText('120 GBP')).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Dashboard currency'), 'EUR');
  await waitFor(() => expect(auth.updateReportingCurrency).toHaveBeenCalledWith('EUR'));
  await waitFor(() => expect(dashboard.get).toHaveBeenCalledWith('EUR', 'month', expect.any(AbortSignal)));
  await userEvent.click(screen.getByRole('button', { name: 'Quarterly' }));
  await waitFor(() => expect(dashboard.get).toHaveBeenCalledWith('EUR', 'quarter', expect.any(AbortSignal)));
  await userEvent.selectOptions(screen.getByLabelText('Dashboard currency'), 'JPY');
  await waitFor(() => expect(auth.updateReportingCurrency).toHaveBeenCalledWith('JPY'));
  await waitFor(() => expect(dashboard.get).toHaveBeenCalledWith('JPY', 'quarter', expect.any(AbortSignal)));
  expect(screen.getByText('75.25 JPY')).toBeInTheDocument();
});

it('shows empty values and offers retry after an API failure', async () => {
  vi.mocked(dashboard.get).mockResolvedValueOnce({ ...data, win_rate: null, average_deal_size: null, revenue: '0.00', revenue_rows: [{ period: '2026-12', revenue: '0.00' }], recent_deals: [] });
  render(<DashboardPage onNavigate={vi.fn()} />);
  expect(await screen.findByText('No paid invoices in this period.')).toBeInTheDocument();
  expect(screen.getAllByText('N/A')).toHaveLength(2);
  vi.mocked(dashboard.get).mockRejectedValueOnce(new Error('Network unavailable'));
  await userEvent.click(screen.getByRole('button', { name: 'Monthly' }));
  await userEvent.click(screen.getByRole('button', { name: 'Quarterly' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('$75.25')).toBeInTheDocument();
});

it('does not show partial converted totals when exchange rates are missing', async () => {
  vi.mocked(dashboard.get).mockResolvedValue({ ...data, pipeline_value: null, average_deal_size: null, revenue: null, revenue_rows: [{ period: '2026-12', revenue: null }], fx: { ...data.fx, missing: { pipeline: ['GBP'], average_deal_size: ['GBP'], revenue: ['PLN'] } } });
  render(<DashboardPage onNavigate={vi.fn()} />);
  expect(await screen.findByText(/ECB rates are unavailable for GBP, PLN/)).toBeInTheDocument();
  expect(screen.getAllByText('Rate unavailable')).toHaveLength(3);
  expect(screen.getByText('Revenue is unavailable until the missing ECB rates are imported.')).toBeInTheDocument();
});
