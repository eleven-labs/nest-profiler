import { EDITOR_NAMES, createEditorLink, resolveEditorTemplate } from './editor-link';

describe('resolveEditorTemplate', () => {
  it('resolves every editor it advertises', () => {
    for (const name of EDITOR_NAMES) {
      expect(resolveEditorTemplate(name)).toContain('%f');
    }
  });

  it('accepts a custom URL template carrying %f', () => {
    expect(resolveEditorTemplate('myeditor://open?file=%f&line=%l')).toBe(
      'myeditor://open?file=%f&line=%l',
    );
  });

  it('rejects a name it does not know and a template with no placeholder', () => {
    expect(resolveEditorTemplate('notepad')).toBeUndefined();
    expect(resolveEditorTemplate('myeditor://open')).toBeUndefined();
    expect(resolveEditorTemplate(undefined)).toBeUndefined();
  });
});

describe('createEditorLink', () => {
  it('builds a path-style link', () => {
    const link = createEditorLink('vscode');
    expect(link('/srv/app/src/product.service.ts', 49)).toBe(
      'vscode://file//srv/app/src/product.service.ts:49',
    );
  });

  it('builds a query-style link', () => {
    const link = createEditorLink('webstorm');
    expect(link('/srv/app/src/product.service.ts', 49)).toBe(
      'webstorm://open?file=/srv/app/src/product.service.ts&line=49',
    );
  });

  it('returns nothing when no editor is configured, so locations render as plain text', () => {
    expect(createEditorLink(undefined)('/srv/app/main.ts', 1)).toBe('');
    expect(createEditorLink('notepad')('/srv/app/main.ts', 1)).toBe('');
  });

  it('returns nothing for a frame that resolved to no absolute path', () => {
    expect(createEditorLink('vscode')(undefined, 1)).toBe('');
  });

  it('falls back to line 1 when the frame carries no line', () => {
    expect(createEditorLink('vscode')('/srv/app/main.ts', undefined)).toBe(
      'vscode://file//srv/app/main.ts:1',
    );
  });

  it('percent-encodes a path so it cannot rewrite the URL around it', () => {
    // `?`, `#` and `&` in a filename would otherwise start a query, a fragment or a new
    // parameter — and the same encoded path has to work in both template shapes.
    const path = '/srv/app/src/we ird?x=1#y&z.ts';
    expect(createEditorLink('vscode')(path, 3)).toBe(
      'vscode://file//srv/app/src/we%20ird%3Fx%3D1%23y%26z.ts:3',
    );
    expect(createEditorLink('webstorm')(path, 3)).toBe(
      'webstorm://open?file=/srv/app/src/we%20ird%3Fx%3D1%23y%26z.ts&line=3',
    );
  });
});
