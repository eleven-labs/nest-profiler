import 'fumadocs-ui/style.css';

import './global.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { RootProvider } from 'fumadocs-ui/provider/next';

import {
  DEFAULT_LANGUAGE,
  GOOGLE_SITE_VERIFICATION,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from '@/lib/constants';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — A Symfony-inspired Web Profiler`,
    template: `%s · ${SITE_NAME}`,
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
    title: `${SITE_NAME} — A Symfony-inspired Web Profiler`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — A Symfony-inspired Web Profiler`,
    description: SITE_DESCRIPTION,
  },
  alternates: {
    canonical: '/',
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
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
