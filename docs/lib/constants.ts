export const SITE_NAME = 'NestJS Profiler';
export const SITE_TAGLINE = 'Symfony-inspired request profiling';
export const SITE_DESCRIPTION =
  "Open-source NestJS profiler inspired by Symfony's Web Profiler: inspect every request — SQL, HTTP, GraphQL, cache and security — to debug and optimize.";
export const GITHUB_URL = 'https://github.com/eleven-labs/nest-profiler';
export const GITHUB_OWNER = 'eleven-labs';
export const GITHUB_REPOSITORY = 'nest-profiler';

/**
 * Public base URL of the deployed documentation site. Override with the
 * NEXT_PUBLIC_SITE_URL environment variable to point at a different domain.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nest-profiler.eleven-labs.com'
).replace(/\/$/, '');

export const ELEVEN_LABS_URL = 'https://eleven-labs.com';

export const TWITTER_HANDLE = '@Eleven_Labs';

export const GOOGLE_SITE_VERIFICATION = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ?? '';

export const DOCS_BASE_PATH = '/docs';
export const DOCS_CONTENT_DIR = 'content/docs';

export const DEFAULT_LANGUAGE = 'en';
export const SUPPORTED_LANGUAGES = ['en'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
