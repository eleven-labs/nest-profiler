import 'fumadocs-ui/style.css';

import './global.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import {
  DEFAULT_LANGUAGE,
  GOOGLE_SITE_VERIFICATION,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
  TWITTER_HANDLE,
} from '@/lib/constants';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  icons: {
    icon: [
      {
        url: '/favicon.ico',
      },
      {
        type: 'image/svg+xml',
        url: '/favicon.svg',
      },
      {
        sizes: '16x16',
        type: 'image/png',
        url: '/icon-16.png',
      },
      {
        sizes: '32x32',
        type: 'image/png',
        url: '/icon-32.png',
      },
    ],

    apple: [
      {
        sizes: '180x180',
        url: '/apple-touch-icon.png',
      },
    ],

    shortcut: ['/favicon.ico'],
  },
  title: {
    default: `${SITE_NAME} - ${SITE_TAGLINE}`,
    template: `${SITE_NAME} - %s`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: 'Fabien Pasquet', url: 'https://github.com/fpasquet' }],
  creator: 'Eleven Labs',
  publisher: 'Eleven Labs',
  keywords: [
    'nestjs',
    'nestjs profiler',
    'web profiler',
    'symfony profiler',
    'debug',
    'devtools',
    'observability',
    'performance',
    'typescript',
    'eleven-labs',
  ],
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    site: TWITTER_HANDLE,
    creator: TWITTER_HANDLE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  formatDetection: {
    telephone: false,
    address: false,
    email: false,
  },
  ...(GOOGLE_SITE_VERIFICATION && {
    verification: { google: GOOGLE_SITE_VERIFICATION },
  }),
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0f' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={DEFAULT_LANGUAGE} suppressHydrationWarning>
      {/* The single Fumadocs RootProvider lives in app/[lang]/layout.tsx with the
          i18n config. Nesting a second one here duplicated the next-themes /
          search providers, so the root layout only renders html/body. */}
      <body>{children}</body>
    </html>
  );
}
