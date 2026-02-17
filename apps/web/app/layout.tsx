import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import QueryProvider from '../shared/lib/query/QueryProvider';
import AuthBootstrap from '../features/auth/AuthBootstrap';
import { ToastProvider } from '../shared/components/ui/Toast';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'BuildingOS',
  description: 'SaaS multi-tenant para administración de condominios y edificios',
};
export const viewport = {
  themeColor: '#1E3A8A',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
      </head>
      <body
        className={[
          geistSans.variable,
          geistMono.variable,
          'antialiased',
          'min-h-screen',
          'bg-background',
          'text-foreground',
        ].join(' ')}
      >
        <ToastProvider>
          <QueryProvider>
            <AuthBootstrap />
            {children}
          </QueryProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
