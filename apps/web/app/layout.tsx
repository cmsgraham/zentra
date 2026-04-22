import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Zentra',
  description: 'Your daily control system',
  icons: {
    icon: [
      { url: '/zentra_logo_azul.png', media: '(prefers-color-scheme: light)' },
      { url: '/zentra_logo_blanco.png', media: '(prefers-color-scheme: dark)' },
    ],
    shortcut: '/zentra_logo_azul.png',
    apple: '/zentra_logo_azul.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@350;400;450;500;550;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
