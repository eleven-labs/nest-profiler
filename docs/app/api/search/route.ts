import { createFromSource } from 'fumadocs-core/search/server';

import { source } from '@/lib/source';

// Self-hosted, free full-text search powered by Orama. Indexes the docs `source`
// (i18n-aware) and serves results at /api/search for the Fumadocs search dialog.
export const { GET } = createFromSource(source);
