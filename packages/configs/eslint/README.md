# @repo/eslint-config

Shared ESLint flat configurations for the monorepo. Three presets are available, each targeting a specific runtime or framework.

## Presets

### `base` — TypeScript / general packages

Extends:

- `@eslint/js` recommended
- `typescript-eslint` recommended
- `eslint-plugin-perfectionist` recommended-natural — with the following rules **disabled** because automatic reordering can break runtime semantics:
  - `sort-objects` — key order is often intentional (API payloads, config readability)
  - `sort-classes` — member order reflects logical structure, not alphabetical grouping
  - `sort-switch-case` — case order can affect fallthrough behavior
  - `sort-modules` — declaration order can be semantically significant
- `eslint-plugin-turbo` recommended (Turborepo env-var awareness)
- `eslint-config-prettier` — **last in chain**, disables all ESLint formatting rules that Prettier already handles (prevents conflicts)

Rules that remain active include `sort-imports`, `sort-named-imports`, `sort-exports`, `sort-interfaces`, `sort-object-types`, `sort-union-types`, `sort-intersection-types`, `sort-enums`, `sort-heritage-clauses`, `sort-jsx-props`, and `sort-type-parameters`.

```js
// eslint.config.mjs
import baseConfig from '@repo/eslint-config/base';

export default baseConfig;
```

---

### `nestjs` — NestJS applications and packages

Extends `base` rules with:

- `typescript-eslint` recommendedTypeChecked (type-aware lint rules, requires a `tsconfig`)
- `eslint-plugin-check-file` — enforces **kebab-case** for all filenames and folders

The `dirname` argument is required so that TypeScript's project service can locate the `tsconfig.json`.

```js
// eslint.config.mjs
import nestjsConfig from '@repo/eslint-config/nestjs';

export default nestjsConfig(import.meta.dirname);
```

Additionally disables `perfectionist/sort-decorators` (inherited from `base`) because NestJS decorator order is functionally significant — e.g. the position of `@UseGuards` relative to `@Get` changes behavior.

#### File naming conventions

All TypeScript files must be named in **kebab-case**. Middle extensions are ignored during validation, so only the base segment is checked:

| File                 | Validated segment | Result |
| -------------------- | ----------------- | ------ |
| `app.module.ts`      | `app`             | ✅     |
| `create-user.dto.ts` | `create-user`     | ✅     |
| `UserService.ts`     | `UserService`     | ❌     |

Covered NestJS file suffixes: `.module`, `.controller`, `.service`, `.provider`, `.guard`, `.pipe`, `.interceptor`, `.filter`, `.middleware`, `.decorator`, `.dto`, `.entity`, `.schema`, `.model`, `.repository`, `.factory`, `.builder`, `.resolver`, `.gateway`, `.strategy`, `.interface`, `.type`, `.enum`, `.config`, `.constants`, `.spec`, `.e2e-spec`.

All **folders** must also follow kebab-case (`users/`, `common/guards/`, etc.).

---

### `nextjs` — Next.js applications with Tailwind CSS

Extends `base` with:

- `@next/eslint-plugin-next` recommended (Core Web Vitals + Next.js rules)
- `eslint-plugin-react-hooks` recommended
- `eslint-plugin-better-tailwindcss` recommended

Ignores `.next/**` and `.source/**` by default.

```js
// eslint.config.mjs
import nextjsConfig from '@repo/eslint-config/nextjs';

export default nextjsConfig();
```

#### Options

| Option               | Type     | Default              | Description                                                                                                                           |
| -------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `tailwindEntryPoint` | `string` | `'./app/global.css'` | Path to the CSS file that contains the `@tailwind` directives, used by `eslint-plugin-better-tailwindcss` to resolve utility classes. |

```js
// Custom Tailwind entry point
export default nextjsConfig({ tailwindEntryPoint: './src/app/globals.css' });
```

## Peer dependencies

| Package                                 | Required by |
| --------------------------------------- | ----------- |
| `eslint >= 9`                           | all presets |
| `@next/eslint-plugin-next >= 15`        | `nextjs`    |
| `eslint-plugin-react-hooks >= 5`        | `nextjs`    |
| `eslint-plugin-better-tailwindcss >= 4` | `nextjs`    |
