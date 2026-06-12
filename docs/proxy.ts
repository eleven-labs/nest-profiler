import { createI18nMiddleware } from 'fumadocs-core/i18n/middleware';

import { i18n } from '@/lib/i18n';

export default createI18nMiddleware(i18n);

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon\\.ico|apple-icon\\.png|icon\\.svg|opengraph-image|screenshots|llms\\.txt|llms-full\\.txt|llms\\.mdx|og/|robots\\.txt|sitemap\\.xml).*)',
  ],
};
