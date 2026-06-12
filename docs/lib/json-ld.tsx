import type { ReactNode } from 'react';

import {
  ELEVEN_LABS_URL,
  GITHUB_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from '@/lib/constants';

const ORGANIZATION = {
  '@type': 'Organization',
  name: 'Eleven Labs',
  url: ELEVEN_LABS_URL,
} as const;

/**
 * Renders a schema.org JSON-LD script tag. `<` is escaped to prevent the
 * serialized JSON from closing the script tag (standard XSS guard).
 */
export function JsonLd({ data }: { data: object }): ReactNode {
  return (
    <script
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
      type="application/ld+json"
    />
  );
}

export function softwareSourceCodeJsonLd(): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    codeRepository: GITHUB_URL,
    programmingLanguage: 'TypeScript',
    runtimePlatform: 'Node.js',
    license: 'https://opensource.org/license/mit',
    isAccessibleForFree: true,
    author: ORGANIZATION,
    publisher: ORGANIZATION,
  };
}

export function techArticleJsonLd({
  title,
  description,
  url,
  lastModified,
}: {
  description?: string;
  lastModified?: Date;
  title: string;
  url: string;
}): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: title,
    ...(description && { description }),
    url: new URL(url, SITE_URL).toString(),
    inLanguage: 'en',
    ...(lastModified && { dateModified: lastModified.toISOString() }),
    author: ORGANIZATION,
    publisher: ORGANIZATION,
  };
}

export function breadcrumbJsonLd(items: { name: string; url?: string }[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(({ name, url }, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name,
      ...(url && { item: new URL(url, SITE_URL).toString() }),
    })),
  };
}
