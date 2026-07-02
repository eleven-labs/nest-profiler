# Extending the profiler UI with JavaScript

The profiler UI ships **all of its browser behaviour as compiled, same-origin JavaScript bundles** — theme toggle, syntax highlighting, copy-to-clipboard, filter forms and tab switching. The HTML templates contain **no inline `<script>` blocks and no `on*` attributes**, so a strict Content-Security-Policy such as `script-src 'self'` works out of the box.

Each bundle is served from the profiler itself (under `/_profiler/__assets/scripts/…`) and injected into the page `<head>`. The core bundle (`profiler.js`) loads first and exposes a small runtime on `window.NestProfiler`; any additional bundle you register loads after it and can reuse that runtime.

## The `window.NestProfiler` runtime

The core bundle exposes a typed helper object other bundles build on. It is the **only** contract between bundles — they never import one another.

| Method                               | Description                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `onReady(fn)`                        | Run `fn` once the DOM is ready (immediately if it already is).                                  |
| `delegate(event, selector, handler)` | Attach a delegated `event` listener on `document`; `handler(element, event)` fires for matches. |
| `copyText(text)`                     | Copy `text` to the clipboard (with a hidden-textarea fallback). Resolves to a `boolean`.        |
| `highlight(root?)`                   | Run highlight.js over `root` (or the whole document when omitted).                              |

Because behaviour is bound through event **delegation**, it keeps working for markup rendered after page load and needs no per-element wiring — you only add `data-*` attributes in your EJS panel.

## Adding your own bundle

If you build your own collector package (see [Timeline & custom collectors](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/collectors)) and it needs browser behaviour, register a script with the `ClientAssetRegistry`. The profiler serves it same-origin and emits its `<script>` tag after `profiler.js`.

### 1. Write and build the client script

Author your behaviour against `window.NestProfiler` and compile it to a single **browser-ready** file (use whatever bundler you like — esbuild, Rollup, `tsc`…). Ship that file inside your package (e.g. under `dist/public/scripts/`).

```ts title="src/client/index.ts"
// Reuse the core runtime — never import the profiler package at runtime.
const api = window.NestProfiler;

api?.delegate('click', '[data-toggle-details]', (row, event) => {
  // Ignore clicks on nested controls (e.g. a copy button).
  if (event.target instanceof Element && event.target.closest('button, a')) return;
  const details = document.getElementById(row.getAttribute('data-details-id') ?? '');
  if (details) details.classList.toggle('hidden');
});
```

In your EJS panel, drive it with plain data attributes — no inline JavaScript:

```html
<tr data-toggle-details data-details-id="row-<%= i %>">
  …
</tr>
<tr id="row-<%= i %>" class="hidden">
  …
</tr>
```

### 2. Register the bundle at startup

Add a small provider that registers the built file's absolute path. The registry is optional-injected, so it is a safe no-op when the profiler is absent or disabled.

```ts title="my-collector-asset.registrar.ts"
import { join } from 'node:path';
import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ClientAssetRegistry } from '@eleven-labs/nest-profiler';

@Injectable()
export class MyCollectorAssetRegistrar implements OnModuleInit {
  constructor(@Optional() private readonly clientAssets?: ClientAssetRegistry) {}

  onModuleInit(): void {
    this.clientAssets?.register({
      file: 'my-collector.js', // unique name, served under /_profiler/__assets/scripts/
      absPath: join(__dirname, 'public', 'scripts', 'my-collector.js'),
    });
  }
}
```

Declare `MyCollectorAssetRegistrar` as a provider in your module — alongside your collector — and the bundle is served and loaded automatically.

> The profiler module must be reachable from your package's module for the registry to inject. Registering it once with `isGlobal: true` (the recommended setup) makes it available everywhere.

The bundled `@eleven-labs/nest-profiler-http` package follows exactly this pattern: it ships an `http.js` bundle that wires up its request-row expand/collapse behaviour through `window.NestProfiler.delegate`.
