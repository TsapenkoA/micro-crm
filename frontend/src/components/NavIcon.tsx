const paths = {
  Dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  Deals: 'M3 5h5v14H3z M10 5h5v9h-5z M17 5h4v12h-4z',
  Clients: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  Invoices: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7',
  Settings: 'M4 6h16 M4 12h16 M4 18h16 M9 4v4 M16 10v4 M10 16v4',
};

export default function NavIcon({ page }: { page: keyof typeof paths }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[page]} /></svg>;
}
