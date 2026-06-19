import type { Metadata } from 'next';

import { getBreadcrumbItems } from 'fumadocs-core/breadcrumb';
import { Callout } from 'fumadocs-ui/components/callout';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { Step, Steps } from 'fumadocs-ui/components/steps';
// 16.10 ships these page-action components publicly (previously vendored).
import { MarkdownCopyButton, ViewOptionsPopover } from 'fumadocs-ui/layouts/docs/page';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';

import { AutoTypeTable } from '@/components/auto-type-table';
import { HeaderOrFooter } from '@/components/header-or-footer';
import { DOCS_BASE_PATH, SITE_NAME, TWITTER_HANDLE } from '@/lib/constants';
import { breadcrumbJsonLd, JsonLd, techArticleJsonLd } from '@/lib/json-ld';
import { source } from '@/lib/source';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; slug?: string[] }>;
}): Promise<Metadata> {
  const { lang, slug } = await params;
  const page = source.getPage(slug, lang);
  if (!page) notFound();

  const { title, description } = page.data;
  // `seo.*` overrides the search-facing metadata only; the page <h1>, sidebar
  // label and on-page lede keep using `title`/`description`.
  const metaTitle = page.data.seo?.title ?? title;
  const metaDescription = page.data.seo?.description ?? description;
  const ogImage = {
    url: `/og/${lang}/docs/${(slug ?? []).join('/')}`,
    width: 1200,
    height: 630,
    alt: metaTitle,
  };

  return {
    title: metaTitle,
    description: metaDescription,
    alternates: {
      canonical: page.url,
    },
    openGraph: {
      type: 'article',
      siteName: SITE_NAME,
      title: metaTitle,
      description: metaDescription,
      url: page.url,
      images: [ogImage],
    },
    twitter: {
      // Nested metadata objects replace (not merge with) the root layout's, so
      // the handle must be repeated here.
      card: 'summary_large_image',
      site: TWITTER_HANDLE,
      creator: TWITTER_HANDLE,
      title: metaTitle,
      description: metaDescription,
      images: [ogImage],
    },
  };
}

export async function generateStaticParams() {
  return source.generateParams();
}

export default async function Page({
  params,
}: {
  params: Promise<{ lang: string; slug?: string[] }>;
}) {
  const { lang, slug } = await params;
  const page = source.getPage(slug, lang);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = `/llms.mdx/${lang}/docs/${(slug ?? []).join('/')}`;

  const rawBreadcrumbs = getBreadcrumbItems(page.url, source.getPageTree(lang), {
    includePage: true,
    includeRoot: { url: DOCS_BASE_PATH },
  })
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name : '',
      url: item.url,
    }))
    .filter((item) => item.name.length > 0);
  // Folder index pages appear twice (folder node + page itself); keep the
  // page entry, which carries the URL.
  const breadcrumbs = rawBreadcrumbs.filter(
    (item, index) => item.name !== rawBreadcrumbs[index + 1]?.name,
  );

  return (
    <DocsPage full={page.data.full} toc={page.data.toc}>
      <JsonLd
        data={techArticleJsonLd({
          title: page.data.title,
          description: page.data.description,
          url: page.url,
          lastModified: page.data.lastModified,
        })}
      />
      <JsonLd data={breadcrumbJsonLd(breadcrumbs)} />
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX
          components={{
            ...defaultMdxComponents,
            AutoTypeTable,
            Callout,
            Card,
            Cards,
            Step,
            Steps,
          }}
        />
        <div className="mt-6 flex flex-row items-center gap-2 border-t pt-4">
          <MarkdownCopyButton markdownUrl={markdownUrl} />
          <ViewOptionsPopover markdownUrl={markdownUrl} />
        </div>
      </DocsBody>
      <HeaderOrFooter />
    </DocsPage>
  );
}
