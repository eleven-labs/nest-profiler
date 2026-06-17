import type { ReactNode } from 'react';

import { HomeLayout } from 'fumadocs-ui/layouts/home';

import { HeaderOrFooter } from '@/components/header-or-footer';
import { GITHUB_URL, SITE_NAME } from '@/lib/constants';
import { i18n } from '@/lib/i18n';

export default async function HomeRootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const base = lang === i18n.defaultLanguage ? '' : `/${lang}`;

  return (
    <HomeLayout
      githubUrl={GITHUB_URL}
      links={[{ text: 'Documentation', url: `${base}/docs`, active: 'nested-url' }]}
      nav={{ title: SITE_NAME, url: base || '/' }}
    >
      {children}
      <HeaderOrFooter className="border-t border-fd-border bg-fd-card/30" />
    </HomeLayout>
  );
}
