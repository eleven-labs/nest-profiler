import { uiTranslations } from 'fumadocs-ui/i18n';

import en from '@/messages/en.json';

import { i18n } from './i18n';

export const translations = i18n.translations().extend(uiTranslations()).add('ui', {
  en,
});
