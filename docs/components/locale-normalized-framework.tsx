'use client';

import type { ComponentProps, ReactNode } from 'react';

import { FrameworkProvider } from 'fumadocs-core/framework';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname as useNextPathname, useParams, useRouter } from 'next/navigation';

import { DEFAULT_LANGUAGE } from '@/lib/constants';

type FrameworkProps = ComponentProps<typeof FrameworkProvider>;

/**
 * With `hideLocale: 'default-locale'`, statically generated pages are rendered
 * under `/<defaultLocale>/...` at build time but served at `/...` on the client.
 * Fumadocs derives the sidebar/active-link state from `usePathname()`, so the
 * build value (`/en/docs/x`) and the client value (`/docs/x`) diverge - which
 * triggers a React hydration mismatch (#418) on every docs page.
 *
 * Re-provide the Fumadocs framework with a `usePathname` that strips the default
 * locale prefix, so SSR and client agree. Non-default locales keep their prefix
 * on both sides, so they are intentionally left untouched.
 */
function useNormalizedPathname(): string {
  const pathname = useNextPathname();
  const prefix = `/${DEFAULT_LANGUAGE}`;
  if (pathname === prefix) return '/';
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  return pathname;
}

export function LocaleNormalizedFramework({ children }: { children: ReactNode }) {
  return (
    <FrameworkProvider
      Image={Image as FrameworkProps['Image']}
      Link={Link as FrameworkProps['Link']}
      useParams={useParams}
      usePathname={useNormalizedPathname}
      useRouter={useRouter}
    >
      {children}
    </FrameworkProvider>
  );
}
