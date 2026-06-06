import type { Metadata } from 'next';

import { Callout } from 'fumadocs-ui/components/callout';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';

import { MarkdownCopyButton, ViewOptionsPopover } from '@/components/ai/page-actions';
import { AutoTypeTable } from '@/components/auto-type-table';
import { SITE_NAME } from '@/lib/constants';
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

  return {
    title,
    description,
    alternates: {
      canonical: page.url,
    },
    openGraph: {
      type: 'article',
      siteName: SITE_NAME,
      title,
      description,
      url: page.url,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
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

  return (
    <DocsPage className="pt-0 xl:pt-0" full={page.data.full} toc={page.data.toc}>
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
    </DocsPage>
  );
}
