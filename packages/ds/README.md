# @genie/ds

Nomi design system — presentational primitives and shared tokens.

## Rules

- Only depends on `react` and `react-native`. Never imports from `@genie/front/screens|context|navigation|store` or `@react-navigation/*`.
- Every component takes theme via a `theme: ThemeDescriptor` prop **or** the app's `useTheme()` — pick one convention per component and document it. Nothing here reads theme from a hardcoded import.
- No hex literals. Only `theme.colors.*`, `theme.spacing.*`, `theme.radius.*`, `theme.typography.*`, `theme.motion.*`.

## Layout

```
src/
  index.ts               // barrel
  tokens/                // shared token defaults (re-exported from front for now)
  components/
    <Name>/index.ts
    <Name>/<Name>.tsx
```
