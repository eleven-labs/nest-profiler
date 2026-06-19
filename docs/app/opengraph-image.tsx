import type { ImageResponse } from 'next/og';

import { SITE_NAME, SITE_TAGLINE } from '@/lib/constants';
import { OG_IMAGE_SIZE, renderOGImage } from '@/lib/og-template';

export const alt = `${SITE_NAME} - ${SITE_TAGLINE}`;
export const size = OG_IMAGE_SIZE;
export const contentType = 'image/png';

export default function OpenGraphImage(): ImageResponse {
  return renderOGImage({
    title: 'A Symfony-inspired Web Profiler for NestJS',
    description:
      'Profile every request - HTTP, database, cache, security, GraphQL, timeline and more.',
  });
}
