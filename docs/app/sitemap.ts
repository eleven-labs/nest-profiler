import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return [];
  /*const url = (path: string) => new URL(path, SITE_URL).toString();

  const home: MetadataRoute.Sitemap = [
    {
      url: url('/'),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];

  const docs: MetadataRoute.Sitemap = source.getPages().map((page) => ({
    url: url(page.url),
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  return [...home, ...docs];*/
}
