import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { ArrowLeft, BookOpen } from 'lucide-react';
import Link from 'next/link';

import { HeaderOrFooter } from '@/components/header-or-footer';
import { DOCS_BASE_PATH, GITHUB_URL, SITE_NAME } from '@/lib/constants';

// Shared 404 UI. Links target default-locale (apex) paths since params are
// unreadable in not-found and the default locale is unprefixed (hideLocale).
export function NotFoundContent() {
  return (
    <HomeLayout
      githubUrl={GITHUB_URL}
      links={[{ active: 'nested-url', text: 'Documentation', url: DOCS_BASE_PATH }]}
      nav={{ title: SITE_NAME, url: '/' }}
    >
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
        <p className="text-sm font-semibold tracking-widest text-fd-primary uppercase">404</p>
        <h1 className="mt-3 max-w-xl text-3xl font-bold tracking-tight text-fd-foreground md:text-4xl">
          This page could not be found
        </h1>
        <p className="mt-4 max-w-md text-fd-muted-foreground">
          The page you are looking for doesn’t exist or has moved. Try the documentation or head
          back to the homepage.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-semibold text-fd-primary-foreground transition-opacity hover:opacity-90"
            href="/"
          >
            <ArrowLeft className="size-4" /> Back home
          </Link>
          <Link
            className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-card px-5 py-2.5 text-sm font-semibold text-fd-foreground transition-colors hover:bg-fd-accent"
            href={DOCS_BASE_PATH}
          >
            <BookOpen className="size-4" /> Browse the docs
          </Link>
        </div>
      </main>
      <HeaderOrFooter className="border-t border-fd-border bg-fd-card/30" />
    </HomeLayout>
  );
}
