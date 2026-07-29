# Repository Guidelines

## Project Structure & Module Organization

Read `00-CONTEXT.md` before `01-SPEC-site.md`, `02-SPEC-printor.md`, and
`03-CONTENT.md`; they remain the product source of truth. The implementation is
a pnpm workspace:

- `apps/site/` — Eleventy v3 portfolio and bilingual Markdown content.
- `apps/printor/` — Vite, React, TypeScript, and WebGL2 application.
- `packages/tokens/` — shared color, type, and spacing tokens.
- `packages/shell/` — reusable tool layout, PWA, support, and error UI.
- `docs/` — specifications, CV inputs, and `decisions.md` ADRs.
- `scripts/` — repository checks, including the site size budget.

Keep browser tools static and client-only. Do not add endpoints, secrets,
telemetry, or runtime uploads.

## Build, Test, and Development Commands

- `pnpm install` — install workspace dependencies.
- `pnpm dev:site` — serve the portfolio at `localhost:8080`.
- `pnpm dev:printor` — serve printor at `127.0.0.1:5173`.
- `pnpm build` — build both apps and enforce size/privacy budgets.
- `pnpm check` — run content checks, TypeScript, builds, and all tests.

Keep these commands synchronized with CI and document app-specific variants in
the root README.

## Coding Style & Naming Conventions

Use TypeScript throughout. Write identifiers, comments, UI strings, commits,
README files, and issues in English; Russian prose belongs under `content/ru/`.
Follow existing two-space indentation in web configuration unless an adopted
formatter dictates otherwise. Use `camelCase` for variables/functions,
`PascalCase` for React components and types, and kebab-case for content slugs
(for example, `magnetic-breathers.md`). Always spell `printor` lowercase.

Reuse tokens rather than duplicating palette or spacing values. New site
dependencies and specification deviations require a short ADR in
`docs/decisions.md`.

## Testing Guidelines

Use Node's test runner for generated-site assertions in `tests/` and Vitest for
printor tests in `apps/printor/tests/`. Prioritize deterministic rendering,
EN/RU route parity, accessibility, offline behavior, and print layouts. CI must
fail if the compressed homepage exceeds 14,336 bytes, printor exceeds 300 KB
gzip, or its CSP permits runtime connections.

## Commit & Pull Request Guidelines

There is no Git history to infer from yet. Follow Conventional Commits with
small, atomic changes, such as `feat(site): add bilingual post layout`.
Pull requests should explain scope, cite the relevant specification section,
link issues, and include screenshots for visual changes. Report build, lint,
test, accessibility, and size-budget results; document intentional deviations
with an ADR.
