import type { Metadata } from 'next';
import { ThemeProvider } from '@/components/theme-provider';
import { MotionProvider } from '@/components/motion-provider';
import './globals.css';
import './workspace.css';

export const metadata: Metadata = {
  title: 'Settlement Trace AI | Evidence-grounded reconciliation',
  description:
    'Trace settlement failures across gateway, bank, and merchant ledger records with explainable evidence.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var p=localStorage.getItem('settlement-trace-theme')||'system';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var t=d?'dark':'light';document.documentElement.classList.add(t);document.documentElement.dataset.theme=t;document.documentElement.dataset.themePreference=p;document.documentElement.style.colorScheme=t}catch(e){document.documentElement.classList.add('dark')}})();` }} />
      </head>
      <body><ThemeProvider><MotionProvider>{children}</MotionProvider></ThemeProvider></body>
    </html>
  );
}
