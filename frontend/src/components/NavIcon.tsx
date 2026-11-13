const paths = {
  Dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  Deals: 'm12 2 9 5-9 5-9-5 9-5Z M3 12l9 5 9-5 M3 17l9 5 9-5',
  Clients: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  Tasks: 'M13 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8 M9 11l3 3L21 5',
  Activity: 'M2 12h4l3-8 4 16 3-8h6',
  Operations: 'M3 4h18v16H3z M3 10h18 M8 4v16 M12 14h6 M12 17h4',
  Invoices: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7',
  Settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M10 2h4l.7 2.2 2 .8 2.1-1 2.8 2.8-1 2.1.8 2L24 10v4l-2.2.7-.8 2 1 2.1-2.8 2.8-2.1-1-2 .8L14 24h-4l-.7-2.2-2-.8-2.1 1-2.8-2.8 1-2.1-.8-2L0 14v-4l2.2-.7.8-2-1-2.1L4.8 2.4l2.1 1 2-.8L10 2Z',
};

export default function NavIcon({ page }: { page: keyof typeof paths }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[page]} /></svg>;
}
