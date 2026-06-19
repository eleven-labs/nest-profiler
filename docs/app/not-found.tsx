import { i18nProvider } from 'fumadocs-ui/i18n';
import { RootProvider } from 'fumadocs-ui/provider/next';

import { NotFoundContent } from '@/components/not-found-content';
import { i18n } from '@/lib/i18n';
import { translations } from '@/lib/translations';

// Global 404 for unmatched URLs; supplies its own RootProvider (no `[lang]` layout).
export default function NotFound() {
  return (
    <RootProvider i18n={i18nProvider(translations, i18n.defaultLanguage)}>
      <NotFoundContent />
    </RootProvider>
  );
}
