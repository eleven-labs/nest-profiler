import 'fumadocs-ui/style.css';

import './global.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { RootProvider } from 'fumadocs-ui/provider/next';

import { DEFAULT_LANGUAGE, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/constants';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — NestJS Web Profiler`,
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
    title: `${SITE_NAME} — NestJS Web Profiler`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — NestJS Web Profiler`,
    description: SITE_DESCRIPTION,
  },
  alternates: {
    canonical: '/',
  },
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
