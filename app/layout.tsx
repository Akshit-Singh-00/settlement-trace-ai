import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Settlement Trace AI | Evidence-grounded reconciliation',
  description:
    'Trace settlement failures across gateway, bank, and merchant ledger records with explainable evidence.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
