# design-sync notes — Nomi DS

Project: **Nomi DS** on claude.ai/design — `02f93517-b6a4-447d-be07-e9ce7fb4c22d`
URL: https://claude.ai/design/p/02f93517-b6a4-447d-be07-e9ce7fb4c22d

**Status:** first sync completed. 8 primitives graded `match` and uploaded (Button, Card,
Chip, Divider, Input, ListItem, Spinner, Text — 49 files total).

## Build & bundling

- `packages/ds` has a Vite `build.lib` — `yarn workspace @nomi/ds build` emits
  `packages/ds/dist/index.js` (15.68 KB ESM, `react-native → react-native-web` alias baked in,
  externals: react, react-dom, react-native-web, react/jsx-runtime).
- Storybook reference: `.design-sync/sb-reference/` — rebuilt in ~4s via
  `npx storybook build -c packages/ds/.storybook -o "$(git rev-parse --show-toplevel)/.design-sync/sb-reference"`.
- Converter bundle: 272 KB, `window.NomiDS`.

## Forks committed under `.design-sync/overrides/`

Two forks address the same root cause — the DS runs on RNW in the browser (like its own
Vite/Storybook), but stories, `.storybook/preview.tsx` decorators, and transitive
`front/src/themes/tokens.ts` all import `from 'react-native'` (Flow syntax that esbuild
won't parse). Both forks add a small esbuild resolve plugin that aliases `react-native →
react-native-web` at compile time.

- `story-imports.mjs` — alias inside the preview-compile esbuild pipeline. Fork points at
  `../../.ds-sync/lib/*.mjs` for its sibling imports.
- `source-storybook.mjs` — same alias inside the DECORATOR bundle (separate esbuild pipeline
  from previews). Also repointed at `../../.ds-sync/lib/*.mjs`.

Both registered in `cfg.libOverrides`. The `.design-sync/node_modules → ../.ds-sync/node_modules`
symlink is gitignored and must be recreated on a fresh clone
(`ln -sfn ../.ds-sync/node_modules .design-sync/node_modules`).

## Validation gate — `--no-render-check`

`package-validate.mjs` reports `[RENDER] root empty` false positives for all 8 components on
React 19 concurrent mode: `page.evaluate(→roots[0].innerHTML)` runs before React commits
first render; the subsequent `page.screenshot` on the same page captures fully-rendered
content (verified via 26–35 KB PNGs with real text pixels in `_screenshots/`). `.render-check.json`
shows `rootEmpty: true, blank: false, texts: [...actual content...]`.

`package-validate.mjs` lives at the converter root, not under `lib/` — the `libOverrides`
fork mechanism doesn't reach it. Workaround: driver runs with `--no-render-check` (skill-
documented legitimate bypass — line 25 & 409 of validate accept the flag with a
`[RENDER_SKIPPED]` warn instead of a fail). All 8 previews were manually graded against
their storybook counterparts via `compare.mjs` — screenshots visually match; every story
verdict is `match` in `.design-sync/.cache/compare/*.grade.json`.

**Follow-up (nice to have):** a converter-side fix would insert
`await page.waitForFunction(() => document.querySelector('[id^="r"]')?.innerHTML?.trim().length > 0, { timeout: 3000 }).catch(() => {})`
before the `page.evaluate` at `package-validate.mjs:495`. Until then, always drive re-syncs
with `--no-render-check` and trust `compare.mjs` for verification.

## Config knobs applied

- `overrides.Divider.cardMode: "column"` — Divider's Horizontal story renders wider than the
  grid cell in the DS pane card. Same for `ListItem.List` story.
- `readmeHeader: ".design-sync/conventions.md"` — mandatory pre-upload conventions header.

## Re-sync risks

- `packages/ds/vite.config.ts`'s `resolve.alias` (`react-native → react-native-web`,
  `@nomi/front → ../../front/src`) governs what ships in `dist/index.js`. Any change to
  those aliases silently changes the compiled bundle — code-review the vite config.
- The two forks (story-imports.mjs, source-storybook.mjs) will drift from upstream on skill
  updates — diff before pulling. The alias plugin block is small (10 lines) and can be
  re-applied by hand.
- If `front/src/themes/*` gains **dynamic** `require('react-native')` beyond static imports,
  the fork's static-resolve alias won't catch it.
- Node v26.3.1 was in use — CI on older Node may behave differently.
- The `close`-that-was-marked-`match`-anyway visual delta on Divider (thin lines rendering
  slightly softer in preview vs storybook) is antialiasing, not a rendering defect. Confirmed
  from `_screenshots/compare/raw/*_Divider_*_ds.png` full-res captures.
- `cfg.provider` is NOT set — the decorator bundle succeeds and provides the theme wrapper
  automatically. If the decorator bundle ever fails again (e.g. a new provider addon in
  `.storybook/preview.tsx`), fall back to explicit `cfg.provider` or an owned preview.

## What ships in the project

49 files:
- `_ds_bundle.js` / `_ds_bundle.css` / `styles.css` / `README.md` / `_ds_needs_recompile` /
  `_ds_sync.json` (anchor)
- `_preview/{Button,Card,Chip,Divider,Input,ListItem,Spinner,Text}.js`
- `_vendor/{react,react-dom,preview-decorators}.js`
- `components/primitives/<Name>/{Name.d.ts, Name.html, Name.jsx, Name.prompt.md}` × 8

## Environment

- Node v26.3.1, yarn workspaces monorepo — `--node-modules ./node_modules` (hoisted).
- Storybook 8.4.7 + `@storybook/react-vite`.
- Playwright chromium installed in `.ds-sync/node_modules/playwright`.

## Follow-up for the app itself

The DS's `import { Platform } from 'react-native'` in `front/src/themes/tokens.ts` is the
sole runtime RN usage transitively pulled into decorators. If tokens.ts moves to a pure
`.web.ts` variant or drops that import, the story-imports and source-storybook forks could
become simpler (or unnecessary). Not urgent — the forks are small and self-contained.
