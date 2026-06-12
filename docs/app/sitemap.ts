import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/constants';
import { source } from '@/lib/source';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const url = (path: string) => new URL(path, SITE_URL).toString();

  const pages = source.getPages();
  const lastModifiedDates = pages
    .map((page) => page.data.lastModified)
    .filter((date): date is Date => date instanceof Date);
  const latest =
    lastModifiedDates.length > 0
      ? new Date(Math.max(...lastModifiedDates.map((date) => date.getTime())))
      : undefined;

  const home: MetadataRoute.Sitemap = [
    {
      url: url('/'),
      lastModified: latest,
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];

  const docs: MetadataRoute.Sitemap = pages.map((page) => ({
    url: url(page.url),
    lastModified: page.data.lastModified,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  return [...home, ...docs];
}
