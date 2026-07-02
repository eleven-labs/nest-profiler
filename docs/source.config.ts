import type { LanguageRegistration } from 'shiki';

import { defineConfig, defineDocs, frontmatterSchema, remarkInclude } from 'fumadocs-mdx/config';
import lastModified from 'fumadocs-mdx/plugins/last-modified';
import { z } from 'zod';

import { DOCS_CONTENT_DIR, SITE_URL } from './lib/constants';

interface MdastNode {
  children?: MdastNode[];
  depth?: number;
  type?: string;
  url?: string;
  value?: string;
}

/**
 * Included package READMEs open with a top-level `# @eleven-labs/...` heading,
 * but Fumadocs already renders the page title as the page's single `<h1>` (via
 * `<DocsTitle>`). Two `<h1>` per page hurts the heading hierarchy and SEO, so
 * demote every body-level `# H1` to `## H2`. Hand-written docs already start at
 * `##`, so this only affects the included READMEs.
 */
function remarkDemoteBodyH1() {
  return (tree: MdastNode): void => {
    const visit = (node: MdastNode): void => {
      if (node.type === 'heading' && node.depth === 1) node.depth = 2;
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

/**
 * READMEs include raw HTML blocks (badges, <picture>, <p align="center">) that
 * are rendered by GitHub but produce unhandled `raw` HAST nodes in MDX. Strip
 * them before the HAST pipeline runs.
 */
function remarkStripRawHtml() {
  return (tree: MdastNode): void => {
    const strip = (node: MdastNode): void => {
      if (node.children) {
        node.children = node.children.filter((child) => child.type !== 'html');
        node.children.forEach(strip);
      }
    };
    strip(tree);
  };
}

/**
 * READMEs reference screenshots by a repo-relative path (e.g.
 * `../../docs/public/screenshots/profiler/x.png`) so they render on the GitHub
 * repo view and stay free of any hardcoded github link. Inside the docs we
 * normalize any such path to the web-root `/screenshots/profiler/...` so the
 * images resolve from `docs/public` - identical preview locally and in prod,
 * without pushing. The match is on the stable `screenshots/profiler/` segment,
 * so it works regardless of how `<include>` leaves the relative prefix.
 */
const SCREENSHOTS_MARKER = 'screenshots/profiler/';
function remarkLocalScreenshots() {
  return (tree: MdastNode): void => {
    const visit = (node: MdastNode): void => {
      if (node.type === 'image' && typeof node.url === 'string') {
        const idx = node.url.indexOf(SCREENSHOTS_MARKER);
        if (idx !== -1) node.url = `/${node.url.slice(idx)}`;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

/**
 * READMEs reference sibling package READMEs by relative file path (e.g.
 * `../nest-profiler/README.md#custom-protocol-adapters`) so the link works on
 * the GitHub repository view. Inside the docs we rewrite those paths to the
 * Fumadocs URL (`/docs/packages/nest-profiler#custom-protocol-adapters`) so
 * in-site navigation works correctly.
 *
 * Only relative links (no `http` scheme) are rewritten. The stable marker is
 * `README.md` in the URL, and the package directory name that precedes it maps
 * directly to the docs slug under `/docs/packages/`.
 */
function remarkReadmeLinks() {
  return (tree: MdastNode): void => {
    const visit = (node: MdastNode): void => {
      if (
        node.type === 'link' &&
        typeof node.url === 'string' &&
        !node.url.startsWith('http') &&
        node.url.includes('README.md')
      ) {
        const match = node.url.match(/\/([\w-]+)\/README\.md(#[\w-]*)?$/);
        if (match) {
          const [, pkgDir, anchor = ''] = match;
          node.url = `/docs/packages/${pkgDir}${anchor}`;
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

/**
 * READMEs and guides link to sibling docs pages by their full absolute URL
 * (e.g. `https://nest-profiler.eleven-labs.com/docs/example-api`) so the link
 * resolves on npm/GitHub where relative paths have no base. Inside the docs
 * site, fumadocs treats any `scheme:` URL as external and opens it in a new tab
 * (`target="_blank"`), even when it points at our own domain. Strip our own
 * origin so those links become root-relative (`/docs/...`) and navigate in-site
 * in the same tab. A bare origin (no path) collapses to `/`.
 *
 * We match against both the configured `SITE_URL` and the canonical host, so
 * links stay in-site even when `NEXT_PUBLIC_SITE_URL` is overridden at build
 * time while the content hardcodes the canonical domain. Every other `http(s)`
 * link (github.com, eleven-labs.com, codecov, shields.io, ...) is left external.
 */
const OWN_ORIGINS = Array.from(new Set(['https://nest-profiler.eleven-labs.com', SITE_URL]));
function remarkInternalLinks() {
  return (tree: MdastNode): void => {
    const visit = (node: MdastNode): void => {
      if (node.type === 'link' && typeof node.url === 'string') {
        const url = node.url;
        const origin = OWN_ORIGINS.find((own) => url.startsWith(own));
        if (origin) node.url = url.slice(origin.length) || '/';
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

/**
 * Each package README ends with an npm-only footer — a `---` rule followed by a
 * paragraph `Part of the [nest-profiler](...) toolkit · Powered & maintained by
 * [Eleven Labs](...)`. It exists so the README renders correctly on npmjs, but
 * inside the docs it duplicates the site chrome. The HTML header logo/tagline is
 * already dropped by `remarkStripRawHtml`; this removes the plain-markdown
 * footer paragraph (and its preceding `---`) so it does not render in-site.
 */
function remarkStripReadmeFooter() {
  const textOf = (node: MdastNode): string =>
    (node.value ?? '') + (node.children?.map(textOf).join('') ?? '');
  const isFooter = (node: MdastNode): boolean => {
    if (node.type !== 'paragraph') return false;
    const text = textOf(node);
    return text.includes('Part of the') && text.includes('toolkit');
  };
  return (tree: MdastNode): void => {
    const visit = (node: MdastNode): void => {
      const children = node.children;
      if (!children) return;
      const idx = children.findIndex(isFooter);
      if (idx !== -1) {
        const removeFrom = children[idx - 1]?.type === 'thematicBreak' ? idx - 1 : idx;
        children.splice(removeFrom, idx - removeFrom + 1);
      }
      children.forEach(visit);
    };
    visit(tree);
  };
}

const ejsLanguage: LanguageRegistration = {
  name: 'ejs',
  scopeName: 'text.html.ejs',
  fileTypes: ['ejs'],
  embeddedLangs: ['html', 'javascript'],
  patterns: [
    { include: '#ejs-comment' },
    { include: '#ejs-block' },
    { include: 'text.html.basic' },
  ],
  repository: {
    'ejs-comment': {
      name: 'comment.block.ejs',
      begin: '<%#',
      end: '%>',
      beginCaptures: { 0: { name: 'punctuation.definition.comment.begin.ejs' } },
      endCaptures: { 0: { name: 'punctuation.definition.comment.end.ejs' } },
    },
    'ejs-block': {
      name: 'meta.embedded.ejs',
      begin: '<%[-=]?',
      end: '-?%>',
      beginCaptures: { 0: { name: 'punctuation.section.embedded.begin.ejs' } },
      endCaptures: { 0: { name: 'punctuation.section.embedded.end.ejs' } },
      contentName: 'source.js',
      patterns: [{ include: 'source.js' }],
    },
  },
};

export const docs = defineDocs({
  dir: DOCS_CONTENT_DIR,
  docs: {
    // `title`/`description` drive the sidebar label, the page <h1> and the
    // on-page lede (UX). The optional `seo` object overrides only the
    // `<title>`, meta description and Open Graph tags (search), so the
    // human-facing content and the search snippet can be tuned independently.
    schema: frontmatterSchema.extend({
      seo: z
        .object({
          title: z.string().optional(),
          description: z.string().optional(),
        })
        .optional(),
    }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export default defineConfig({
  // Git-based last modified dates, surfaced as `page.data.lastModified` (sitemap
  // <lastmod>, JSON-LD dateModified). On Vercel set VERCEL_DEEP_CLONE=true so the
  // full git history is available at build time.
  plugins: [lastModified()],
  mdxOptions: {
    // Insert the screenshot path normalizer right after `remarkInclude` (so it
    // sees images coming from included READMEs) and before the built-in
    // `remarkImage` (so they are treated as local images with dimensions/zoom).
    remarkPlugins: (plugins) => {
      const includeIndex = plugins.findIndex(
        (plugin) =>
          plugin === remarkInclude || (Array.isArray(plugin) && plugin[0] === remarkInclude),
      );
      const next = [...plugins];
      next.splice(
        includeIndex === -1 ? 0 : includeIndex + 1,
        0,
        remarkStripRawHtml as (typeof plugins)[number],
        remarkStripReadmeFooter as (typeof plugins)[number],
        remarkDemoteBodyH1 as (typeof plugins)[number],
        remarkLocalScreenshots as (typeof plugins)[number],
        remarkReadmeLinks as (typeof plugins)[number],
        remarkInternalLinks as (typeof plugins)[number],
      );
      return next;
    },
    rehypeCodeOptions: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      langs: ['html', 'javascript', ejsLanguage],
    },
  },
});
