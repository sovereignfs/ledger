import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@sovereignfs/ui/tokens.css';

export const metadata: Metadata = { title: 'Ledger' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
