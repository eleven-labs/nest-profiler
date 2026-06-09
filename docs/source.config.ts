import type { LanguageRegistration } from 'shiki';

import { defineConfig, defineDocs, remarkInclude } from 'fumadocs-mdx/config';

import { DOCS_CONTENT_DIR } from './lib/constants';

interface MdastNode {
  children?: MdastNode[];
  type?: string;
  url?: string;
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
 * images resolve from `docs/public` — identical preview locally and in prod,
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
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export default defineConfig({
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
        remarkLocalScreenshots as (typeof plugins)[number],
        remarkReadmeLinks as (typeof plugins)[number],
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
