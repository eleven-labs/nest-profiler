import { defineI18n } from 'fumadocs-core/i18n';

import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from '@/lib/constants';

export const i18n = defineI18n({
  defaultLanguage: DEFAULT_LANGUAGE,
  hideLocale: 'default-locale',
  languages: [...SUPPORTED_LANGUAGES],
});
