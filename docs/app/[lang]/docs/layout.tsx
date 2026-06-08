import type { ReactNode } from 'react';

import { GithubInfo } from 'fumadocs-ui/components/github-info';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';

import { HeaderOrFooter } from '@/components/header-or-footer';
import { GITHUB_OWNER, GITHUB_REPOSITORY, GITHUB_URL, SITE_NAME } from '@/lib/constants';
import { i18n } from '@/lib/i18n';
import { source } from '@/lib/source';

export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const homeUrl = lang === i18n.defaultLanguage ? '/' : `/${lang}`;

  return (
    <DocsLayout
      githubUrl={GITHUB_URL}
      links={[
        {
          children: (
            <GithubInfo
              owner={GITHUB_OWNER}
              repo={GITHUB_REPOSITORY}
              token={process.env.GITHUB_TOKEN}
            />
          ),
          type: 'custom',
        },
      ]}
      nav={{ title: SITE_NAME, url: homeUrl }}
      sidebar={{ banner: <SidebarBanner lang={lang} /> }}
      tree={source.getPageTree(lang)}
    >
      {children}
      <HeaderOrFooter />
    </DocsLayout>
  );
}

function SidebarBanner({ lang }: { lang: string }) {
  return (
    <div
      className="
        rounded-lg border border-fd-border bg-fd-primary/5 px-3 py-2 text-xs
        text-fd-muted-foreground
      "
    >
      <span className="font-semibold text-fd-primary">
        {lang === i18n.defaultLanguage
          ? 'Open source NestJS packages'
          : 'Packages NestJS open source'}
      </span>
    </div>
  );
}
