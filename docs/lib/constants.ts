export const SITE_NAME = 'NestJS Packages';
export const SITE_DESCRIPTION =
  'Documentation for reusable NestJS packages and the example application.';
export const GITHUB_URL = 'https://github.com/eleven-labs/nest-profiler';

export const DOCS_BASE_PATH = '/docs';
export const DOCS_CONTENT_DIR = 'content/docs';

export const DEFAULT_LANGUAGE = 'en';
export const SUPPORTED_LANGUAGES = ['en'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
