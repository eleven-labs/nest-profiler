---
'@eleven-labs/nest-profiler': minor
'@eleven-labs/nest-profiler-http': patch
---

Ship the profiler UI's browser behaviour as compiled, same-origin JavaScript bundles instead of inline template scripts, and make the client layer extensible.

- All authored client behaviour (theme toggle, syntax highlighting, copy-to-clipboard, filter forms, tab switching) now lives in TypeScript, is bundled at build time, and is served under `/_profiler/__assets/scripts/*`. The HTML templates carry no inline `<script>` blocks and no `on*` attributes, so a strict `script-src 'self'` Content-Security-Policy works out of the box.
- New `window.NestProfiler` browser runtime (`onReady`, `delegate`, `copyText`, `highlight`) that other bundles reuse — the only cross-bundle contract.
- New `ClientAssetRegistry` service (exported, with `CORE_CLIENT_SCRIPT` and the `ClientAssetRegistration` type): a package shipping its own collector can register a client bundle so the profiler serves it and injects its `<script>` after `profiler.js`.
- `nest-profiler-http`: the HTTP Client panel's request-row expand/collapse behaviour moves out of inline template handlers into a compiled `http.js` bundle registered automatically via `ClientAssetRegistry` — a reference implementation of the pattern. No consumer-facing change.
