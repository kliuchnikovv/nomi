# design-sync notes — Nomi DS

Project: `Nomi DS` on claude.ai/design — `02f93517-b6a4-447d-be07-e9ce7fb4c22d`.

## Blocker: no dist/ for packages/ds

The package's `main`/`types` point at `src/index.ts` and there is no build script. The `bundle.mjs`
esbuild pass fails at `node_modules/react-native/index.js` (Flow syntax `import typeof`) because
the DS components all import from `react-native`, which is meant to be substituted for
`react-native-web` in browser contexts. Storybook handles it via `vite.config.ts` alias
(`react-native → react-native-web`); the converter's esbuild does not.

The DS also imports `@genie/front/themes/types` (workspace path) — same story: fine in Storybook
via the Vite alias, unresolved in a bare esbuild.

**Fix (before continuing sync):** add a real library build to `packages/ds` (Vite `build.lib` or
tsup) that resolves both aliases at build time and emits `dist/index.js`. Then run the converter
with `--entry ./packages/ds/dist/index.js`.

## Environment

- Node v26.3.1 (verify with converter compatibility — very new)
- yarn workspaces monorepo — root `node_modules` is the hoist target; pass
  `--node-modules ./node_modules` to the converter.
- Storybook 8.4.7 + `@storybook/react-vite`; `.storybook/main.ts` at `packages/ds/.storybook`.
- Chromium already installed via `.ds-sync/node_modules/playwright`.

## Config already recorded

```json
{
  "projectId": "02f93517-b6a4-447d-be07-e9ce7fb4c22d",
  "shape": "storybook",
  "pkg": "packages/ds",
  "globalName": "GenieDS",
  "storybookConfigDir": "packages/ds/.storybook",
  "storybookStatic": ".design-sync/sb-reference"
}
```

After the DS gains a build, add:
- `"buildCmd": "yarn workspace @genie/ds build"` (or whatever the script name lands as)
- `"entry": "./packages/ds/dist/index.js"` — so re-syncs pick it up automatically

## Components synced (8)

Button, Card, Chip, Divider, Input, ListItem, Spinner, Text — see `packages/ds/src/components/`.
Each has a `.stories.tsx` file (27 stories total, all paired to module exports per the last
converter build attempt).

## Re-sync risks

- Reference storybook build is fast (~4s), but must be rebuilt whenever `packages/ds/src/**` or
  the `.storybook/preview.tsx` decorators change. Don't skip — a stale reference makes every
  grade a comparison against the old design.
- Once a `dist/` build exists, verify that the `react-native-web` version bundled into dist
  matches what Storybook uses in `sb-reference` — a version drift makes previews and reference
  render differently for the same source.
- `@genie/front/themes/*` is a workspace path — the DS bundle should either inline the theme
  types/tokens it uses, or the converter needs `cfg.tokensPkg` pointing at a dedicated tokens
  package.
