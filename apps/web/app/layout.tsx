import type { Metadata, Viewport } from 'next';
import './globals.css';
import ServiceWorkerRegister from '@/components/pwa/ServiceWorkerRegister';
import CacheVisitedListPage from '@/components/pwa/CacheVisitedListPage';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || 'https://usezentra.app';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Zentra',
  description: 'Your daily control system',
  alternates: {
    canonical: '/',
  },
  manifest: '/manifest.webmanifest',
  applicationName: 'Zentra',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Zentra',
  },
  icons: {
    icon: [
      { url: '/zentra_logo_azul.png', media: '(prefers-color-scheme: light)' },
      { url: '/zentra_logo_blanco.png', media: '(prefers-color-scheme: dark)' },
    ],
    shortcut: '/zentra_logo_azul.png',
    apple: '/zentra_logo_azul.png',
  },
  // Google Search Console domain ownership verification.
  // Set NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION in apps/web env to the token
  // shown by Search Console (the value of the `content` attribute).
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#191f4a' },
    { media: '(prefers-color-scheme: dark)', color: '#14151c' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <ServiceWorkerRegister />
        <CacheVisitedListPage />
        {children}
      </body>
    </html>
  );
}
