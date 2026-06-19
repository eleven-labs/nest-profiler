import type { ReactNode } from 'react';

import { i18nProvider } from 'fumadocs-ui/i18n';
import { RootProvider as I18nProvider } from 'fumadocs-ui/provider/next';

import { LocaleNormalizedFramework } from '@/components/locale-normalized-framework';
import { i18n } from '@/lib/i18n';
import { translations } from '@/lib/translations';

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}

export default async function LangLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;

  return (
    <I18nProvider i18n={i18nProvider(translations, lang)}>
      <LocaleNormalizedFramework>{children}</LocaleNormalizedFramework>
    </I18nProvider>
  );
}
