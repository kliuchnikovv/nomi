# Nomi DS — how to build with these components

This design system is React Native components running on `react-native-web` in the browser.
Components are exported globally as `window.GenieDS.*`. Style is passed as a `theme` **prop**,
never through CSS classes or a `ThemeProvider` — every component that renders content takes a
`theme: ThemeDescriptor` and reads its colors, typography, spacing, and radius from it.

## Setup — no wrapper needed

There is no provider. Import a theme, pass it into each component:

```tsx
import { Text, Button, Card } from '@genie/ds';
import { darkMinimalTheme } from '@genie/front/themes/darkMinimal';

// ...

<Card theme={darkMinimalTheme} elevation="raised" padding="lg">
    <Text theme={darkMinimalTheme} variant="title">Hello</Text>
    <Text theme={darkMinimalTheme} variant="body" tone="secondary">
        The theme prop supplies typography, colors, and radius.
    </Text>
    <Button theme={darkMinimalTheme} variant="primary" size="md" onPress={() => {}}>
        Continue
    </Button>
</Card>
```

Available themes (in `@genie/front/themes/`):
`darkMinimalTheme`, `visualStudioLightTheme`, `tokyoNightTheme`, `retroSunsetTheme` (see
`packages/ds/.storybook/preview.tsx` for the full list, and additional themes in the same dir).

## Styling idiom — props, not classes

All visual choices are prop-driven. Never invent CSS class names — the DS does not use any.

**Typography variants** (`variant` prop on `Text`): `display`, `title`, `body`, `caption`, `mono`.

**Tone** (`tone` prop on `Text` and some others): `primary`, `secondary`, `faded`, `accent`,
`error`, `success`, `warning`.

**Component-specific knobs** (from `.d.ts` files under `components/primitives/<Name>/<Name>.d.ts`):

| Component | Knobs |
|---|---|
| `Button`   | `variant`: `primary` \| `secondary` \| `ghost` \| `danger`; `size`: `sm` \| `md` \| `lg`; `loading`, `disabled` |
| `Card`     | `surface`: `surface` \| `surfaceAlt` \| `surfaceHighlight` \| `transparent`; `elevation`: `none` \| `raised` \| `inset`; `padding`, `radius`; `bordered` |
| `Chip`     | `variant`: `solid` \| `soft` \| `outlined`; `tone`: `default` \| `accent` \| `success` \| `error` \| `warning`; `size`: `sm` \| `md`; `selected`, `disabled`, `onPress` |
| `Divider`  | `orientation`: `horizontal` \| `vertical`; `inset` |
| `Input`    | `size`; `label`, `error`, `helperText`; `disabled` |
| `ListItem` | `density`; `selected`; `left`, `right` (slots); `onPress` |
| `Spinner`  | `size`: `sm` \| `md` \| `lg`; `tone`: `primary` \| `accent` \| `onAccent` |
| `Text`     | `variant`, `tone`, `weight`, `align` |

For layout **around** these components use React Native's own primitives: `<View style={{ … }}>`
from `react-native-web` (via `window.GenieDS` reserved for DS exports; import RN primitives
directly). `style` is a `StyleProp<ViewStyle | TextStyle>` object, not a className.

## Where to look

- `.d.ts` for each component under `components/primitives/<Name>/` — the source of truth for
  props and their exact enum values.
- `.prompt.md` next to each `.d.ts` shows the actual variants used in stories.
- Full theme shape (`ThemeDescriptor` with `colors`, `typography`, `radius`, `spacing`,
  `motion`): `front/src/themes/types.ts`.

## One idiomatic build snippet

```tsx
import { Card, Text, Button, Divider } from '@genie/ds';
import { View } from 'react-native-web';
import { darkMinimalTheme as t } from '@genie/front/themes/darkMinimal';

function TaskCard({ title, subtitle, onOpen }) {
    return (
        <Card theme={t} surface="surface" elevation="raised" padding="lg" radius="md">
            <Text theme={t} variant="title">{title}</Text>
            <Text theme={t} variant="body" tone="secondary" style={{ marginTop: 4 }}>
                {subtitle}
            </Text>
            <Divider theme={t} orientation="horizontal" style={{ marginVertical: 12 }} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button theme={t} variant="primary" size="md" onPress={onOpen}>Open</Button>
                <Button theme={t} variant="ghost" size="md" onPress={() => {}}>Dismiss</Button>
            </View>
        </Card>
    );
}
```
