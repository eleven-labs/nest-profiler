import type { NextConfig } from 'next';

import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** Tutorials merged into a single page — keep the published URLs working. */
const MERGED_TUTORIALS = ['typeorm-collector', 'mikro-orm-collector'];

const config: NextConfig = {
  reactStrictMode: true,
  redirects: () =>
    Promise.resolve(
      MERGED_TUTORIALS.flatMap((slug) => [
        {
          source: `/docs/tutorials/${slug}`,
          destination: '/docs/tutorials/sql-collectors',
          permanent: true,
        },
        {
          source: `/:lang/docs/tutorials/${slug}`,
          destination: '/:lang/docs/tutorials/sql-collectors',
          permanent: true,
        },
      ]),
    ),
};

export default withMDX(config);
