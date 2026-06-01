import { loader } from 'fumadocs-core/source';

import { docs } from '@/.source/server';
import { DOCS_BASE_PATH } from '@/lib/constants';
import { i18n } from '@/lib/i18n';

export const source = loader({
  baseUrl: DOCS_BASE_PATH,
  i18n,
  source: docs.toFumadocsSource(),
});
