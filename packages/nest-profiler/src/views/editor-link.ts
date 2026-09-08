/**
 * Editors the `editor` option knows by name. Anything else is given as a URL template carrying
 * `%f` (absolute path) and `%l` (line) — the same contract as Symfony's `framework.ide`.
 */
export type ProfilerEditorName =
  | 'vscode'
  | 'vscode-insiders'
  | 'cursor'
  | 'windsurf'
  | 'zed'
  | 'webstorm'
  | 'idea'
  | 'phpstorm'
  | 'sublime'
  | 'textmate';

const EDITOR_URL_TEMPLATES: Record<ProfilerEditorName, string> = {
  vscode: 'vscode://file/%f:%l',
  'vscode-insiders': 'vscode-insiders://file/%f:%l',
  cursor: 'cursor://file/%f:%l',
  windsurf: 'windsurf://file/%f:%l',
  zed: 'zed://file/%f:%l',
  webstorm: 'webstorm://open?file=%f&line=%l',
  idea: 'idea://open?file=%f&line=%l',
  phpstorm: 'phpstorm://open?file=%f&line=%l',
  sublime: 'subl://open?url=file://%f&line=%l',
  textmate: 'txmt://open?url=file://%f&line=%l',
};

export const EDITOR_NAMES = Object.keys(EDITOR_URL_TEMPLATES) as ProfilerEditorName[];

/** Builds the `href` opening `file` at `line`, or `''` when no editor is configured. */
export type EditorLink = (file: string | undefined, line: number | undefined) => string;

const NO_LINK: EditorLink = () => '';

/**
 * Percent-encodes a path for a URL, keeping `/` readable. Encoding everything else lets the same
 * template serve a path segment (`vscode://file/%f`) and a query value (`?file=%f`), and keeps a
 * path containing `?`, `#` or `&` from rewriting the URL around it.
 */
function encodePath(path: string): string {
  return encodeURIComponent(path).replace(/%2F/g, '/');
}

/** The URL template for a configured editor, or `undefined` when it names nothing usable. */
export function resolveEditorTemplate(editor: string | undefined): string | undefined {
  if (!editor) return undefined;
  const known = EDITOR_URL_TEMPLATES[editor as ProfilerEditorName];
  if (known) return known;
  return editor.includes('%f') ? editor : undefined;
}

/**
 * The template global every source location in the UI links through.
 *
 * Only a frame that resolved to an absolute path under the project root carries one, so the value
 * interpolated here is never free-form text out of a stack trace.
 */
export function createEditorLink(editor: string | undefined): EditorLink {
  const template = resolveEditorTemplate(editor);
  if (!template) return NO_LINK;

  return (file, line) => {
    if (!file) return '';
    return template.replace(/%f/g, encodePath(file)).replace(/%l/g, String(line ?? 1));
  };
}
