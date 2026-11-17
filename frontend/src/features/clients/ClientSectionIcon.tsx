const paths = {
  overview: 'M3 3h8v8H3z M13 3h8v5h-8z M13 10h8v11h-8z M3 13h8v8H3z',
  contacts: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  deals: 'm12 2 9 5-9 5-9-5 9-5Z M3 12l9 5 9-5 M3 17l9 5 9-5',
  tasks: 'M13 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8 M9 11l3 3L21 5',
  invoices: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7',
  notes: 'M4 4h16v13H8l-4 4V4Z M8 9h8 M8 13h6',
  links: 'M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1 M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1',
  files: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h5',
  bank: 'M3 9h18 M5 9v10 M10 9v10 M14 9v10 M19 9v10 M2 21h20 M2 9l10-6 10 6',
  email: 'M3 5h18v14H3z M3 6l9 7 9-7',
  phone: 'M5 3h4l1 5-2 2a16 16 0 0 0 6 6l2-2 5 1v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z',
  edit: 'M4 20h4L20 8l-4-4L4 16v4Z M14 6l4 4',
  delete: 'M4 7h16 M9 7V4h6v3 M7 7l1 13h8l1-13 M10 11v6 M14 11v6',
  calendar: 'M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4',
  external: 'M14 3h7v7 M21 3l-11 11 M10 3H3v18h18v-7',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 15v6h16v-6',
  send: 'm22 2-7 20-4-9-9-4 20-7Z M22 2 11 13',
} as const;

export default function ClientSectionIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="client-section-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
