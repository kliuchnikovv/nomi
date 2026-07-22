import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { Text as Text$1, StyleSheet, Pressable, ActivityIndicator, View, TextInput, Platform } from "react-native-web";
import { forwardRef, useState } from "react";
const toneToColor$1 = (tone, colors) => {
  switch (tone) {
    case "primary":
      return colors.textPrimary;
    case "secondary":
      return colors.textSecondary;
    case "faded":
      return colors.fadedText;
    case "accent":
      return colors.accent;
    case "error":
      return colors.error ?? colors.attention;
    case "success":
      return colors.success ?? colors.accent;
    case "warning":
      return colors.warning ?? colors.accent;
  }
};
const Text = ({
  theme,
  variant = "body",
  tone = "primary",
  align,
  weight,
  style,
  ...rest
}) => {
  const v = theme.typography[variant];
  const composed = {
    fontFamily: v.fontFamily,
    fontSize: v.fontSize,
    lineHeight: v.lineHeight,
    fontWeight: weight ?? v.fontWeight,
    color: toneToColor$1(tone, theme.colors)
  };
  if (v.letterSpacing !== void 0) {
    composed.letterSpacing = v.letterSpacing;
  }
  if (align !== void 0) {
    composed.textAlign = align;
  }
  return /* @__PURE__ */ jsx(Text$1, { ...rest, style: StyleSheet.flatten([composed, style]) });
};
const visualFor = (variant, theme) => {
  const { colors } = theme;
  const primary = colors.primary ?? colors.accent;
  const danger = colors.error ?? colors.attention;
  switch (variant) {
    case "primary":
      return {
        bg: primary,
        bgPressed: primary,
        bgDisabled: colors.surfaceAlt,
        fg: colors.background,
        fgDisabled: colors.fadedText,
        borderColor: void 0,
        borderWidth: 0
      };
    case "secondary":
      return {
        bg: colors.surface,
        bgPressed: colors.surfaceHighlight,
        bgDisabled: colors.surfaceAlt,
        fg: colors.textPrimary,
        fgDisabled: colors.fadedText,
        borderColor: colors.border,
        borderWidth: 1
      };
    case "ghost":
      return {
        bg: "transparent",
        bgPressed: colors.surfaceHighlight,
        bgDisabled: "transparent",
        fg: primary,
        fgDisabled: colors.fadedText,
        borderColor: void 0,
        borderWidth: 0
      };
    case "danger":
      return {
        bg: danger,
        bgPressed: danger,
        bgDisabled: colors.surfaceAlt,
        fg: colors.background,
        fgDisabled: colors.fadedText,
        borderColor: void 0,
        borderWidth: 0
      };
  }
};
const sizeFor$2 = (size, theme) => {
  const { spacing } = theme;
  switch (size) {
    case "sm":
      return { paddingV: spacing.xs, paddingH: spacing.md, minHeight: 32, gap: spacing.xs, textVariant: "caption" };
    case "md":
      return { paddingV: spacing.sm, paddingH: spacing.lg, minHeight: 44, gap: spacing.sm, textVariant: "body" };
    case "lg":
      return { paddingV: spacing.md, paddingH: spacing.xl, minHeight: 52, gap: spacing.sm, textVariant: "body" };
  }
};
const Button = ({
  theme,
  label,
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  leftIcon,
  rightIcon,
  disabled,
  style,
  labelStyle,
  ...rest
}) => {
  const v = visualFor(variant, theme);
  const s = sizeFor$2(size, theme);
  const isDisabled = disabled || loading;
  return /* @__PURE__ */ jsx(
    Pressable,
    {
      ...rest,
      disabled: isDisabled,
      style: ({ pressed }) => {
        const composed = {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: s.paddingV,
          paddingHorizontal: s.paddingH,
          minHeight: s.minHeight,
          borderRadius: theme.radius.md,
          backgroundColor: isDisabled ? v.bgDisabled : pressed ? v.bgPressed : v.bg,
          borderWidth: v.borderWidth,
          opacity: pressed && !isDisabled ? 0.9 : 1,
          alignSelf: fullWidth ? "stretch" : "flex-start"
        };
        if (v.borderColor !== void 0) {
          composed.borderColor = v.borderColor;
        }
        return StyleSheet.flatten([composed, style]);
      },
      children: loading ? /* @__PURE__ */ jsx(ActivityIndicator, { size: "small", color: v.fg }) : /* @__PURE__ */ jsxs(Fragment, { children: [
        leftIcon !== void 0 ? /* @__PURE__ */ jsx(View, { style: { marginRight: s.gap }, children: leftIcon }) : null,
        /* @__PURE__ */ jsx(
          Text,
          {
            theme,
            variant: s.textVariant,
            weight: "600",
            style: StyleSheet.flatten([{ color: isDisabled ? v.fgDisabled : v.fg }, labelStyle]),
            children: label
          }
        ),
        rightIcon !== void 0 ? /* @__PURE__ */ jsx(View, { style: { marginLeft: s.gap }, children: rightIcon }) : null
      ] })
    }
  );
};
const surfaceColor = (surface, theme) => {
  switch (surface) {
    case "surface":
      return theme.colors.surface;
    case "surfaceAlt":
      return theme.colors.surfaceAlt;
    case "surfaceHighlight":
      return theme.colors.surfaceHighlight;
    case "transparent":
      return "transparent";
  }
};
const Card = ({
  theme,
  padding = "lg",
  radius = "lg",
  surface = "surface",
  bordered = false,
  elevation = "none",
  style,
  children,
  ...rest
}) => {
  const composed = {
    backgroundColor: surfaceColor(surface, theme),
    borderRadius: theme.radius[radius]
  };
  if (padding !== "none") {
    composed.padding = theme.spacing[padding];
  }
  if (bordered) {
    composed.borderWidth = 1;
    composed.borderColor = theme.colors.border;
  }
  if (elevation !== "none" && theme.effects !== void 0) {
    const shadow = elevation === "raised" ? theme.effects.cardShadowRaised : theme.effects.cardShadowInset;
    composed.shadowColor = shadow.shadowColor;
    composed.shadowOffset = shadow.shadowOffset;
    composed.shadowOpacity = shadow.shadowOpacity;
    composed.shadowRadius = shadow.shadowRadius;
    if (shadow.elevation !== void 0) {
      composed.elevation = shadow.elevation;
    }
  }
  return /* @__PURE__ */ jsx(View, { ...rest, style: StyleSheet.flatten([composed, style]), children });
};
const toneBase = (tone, colors) => {
  switch (tone) {
    case "default":
      return colors.textPrimary;
    case "accent":
      return colors.primary ?? colors.accent;
    case "success":
      return colors.success ?? colors.accent;
    case "error":
      return colors.error ?? colors.attention;
    case "warning":
      return colors.warning ?? colors.accent;
  }
};
const sizeFor$1 = (size, theme) => {
  const s = theme.spacing;
  return size === "sm" ? { paddingV: s.xs, paddingH: s.sm, gap: s.xs, textVariant: "caption" } : { paddingV: s.sm, paddingH: s.md, gap: s.xs, textVariant: "body" };
};
const Chip = ({
  theme,
  label,
  tone = "default",
  variant = "soft",
  size = "sm",
  selected = false,
  leftIcon,
  rightIcon,
  onPress,
  disabled,
  style,
  ...rest
}) => {
  const base = toneBase(tone, theme.colors);
  const s = sizeFor$1(size, theme);
  const pressable = onPress !== void 0 && !disabled;
  const surface = variant === "solid" ? base : variant === "soft" ? tone === "default" ? theme.colors.surface : `${base}22` : "transparent";
  const fg = variant === "solid" ? theme.colors.background : base;
  const borderColor = variant === "outlined" ? base : selected ? base : theme.colors.border;
  const borderWidth = variant === "outlined" || selected ? 1 : 0;
  const containerStyle = (pressed) => ({
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: s.paddingV,
    paddingHorizontal: s.paddingH,
    borderRadius: theme.radius.pill,
    backgroundColor: surface,
    borderWidth,
    borderColor,
    opacity: disabled ? 0.5 : pressed && pressable ? 0.85 : 1,
    alignSelf: "flex-start"
  });
  const content = /* @__PURE__ */ jsxs(Fragment, { children: [
    leftIcon !== void 0 ? /* @__PURE__ */ jsx(View, { style: { marginRight: s.gap }, children: leftIcon }) : null,
    /* @__PURE__ */ jsx(Text, { theme, variant: s.textVariant, weight: "500", style: { color: fg }, children: label }),
    rightIcon !== void 0 ? /* @__PURE__ */ jsx(View, { style: { marginLeft: s.gap }, children: rightIcon }) : null
  ] });
  if (!pressable) {
    return /* @__PURE__ */ jsx(View, { style: StyleSheet.flatten([containerStyle(false), style]), children: content });
  }
  return /* @__PURE__ */ jsx(
    Pressable,
    {
      ...rest,
      onPress,
      disabled,
      style: ({ pressed }) => StyleSheet.flatten([containerStyle(pressed), style]),
      children: content
    }
  );
};
const Divider = ({
  theme,
  orientation = "horizontal",
  inset = "none",
  thickness = StyleSheet.hairlineWidth,
  color,
  style
}) => {
  const insetValue = inset === "none" ? 0 : theme.spacing[inset];
  const base = orientation === "horizontal" ? { height: thickness, alignSelf: "stretch", marginHorizontal: insetValue } : { width: thickness, alignSelf: "stretch", marginVertical: insetValue };
  base.backgroundColor = color ?? theme.colors.border;
  return /* @__PURE__ */ jsx(View, { style: StyleSheet.flatten([base, style]) });
};
const sizeFor = (size, theme) => {
  const sp = theme.spacing;
  switch (size) {
    case "sm":
      return { paddingV: sp.xs, paddingH: sp.sm, minHeight: 32, gap: sp.xs, textVariant: "caption" };
    case "md":
      return { paddingV: sp.sm, paddingH: sp.md, minHeight: 40, gap: sp.sm, textVariant: "body" };
    case "lg":
      return { paddingV: sp.md, paddingH: sp.lg, minHeight: 48, gap: sp.sm, textVariant: "body" };
  }
};
const Input = forwardRef(function Input2({
  theme,
  size = "md",
  label,
  hint,
  error,
  leftAdornment,
  rightAdornment,
  containerStyle,
  inputStyle,
  editable,
  onFocus,
  onBlur,
  placeholderTextColor,
  ...rest
}, ref) {
  const [focused, setFocused] = useState(false);
  const s = sizeFor(size, theme);
  const disabled = editable === false;
  const hasError = Boolean(error);
  const errorColor = theme.colors.error ?? theme.colors.attention;
  const accent = theme.colors.primary ?? theme.colors.accent;
  const borderColor = hasError ? errorColor : focused ? accent : theme.colors.border;
  const fieldStyle = {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: s.paddingV,
    paddingHorizontal: s.paddingH,
    minHeight: s.minHeight,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor,
    backgroundColor: disabled ? theme.colors.surfaceAlt : theme.colors.surface,
    opacity: disabled ? 0.7 : 1
  };
  const textInputStyle = {
    flex: 1,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.body.fontFamily,
    fontSize: s.textVariant === "caption" ? theme.typography.caption.fontSize : theme.typography.body.fontSize,
    padding: 0
  };
  return /* @__PURE__ */ jsxs(View, { style: containerStyle, children: [
    label !== void 0 ? /* @__PURE__ */ jsx(Text, { theme, variant: "caption", tone: "secondary", style: { marginBottom: theme.spacing.xs }, children: label }) : null,
    /* @__PURE__ */ jsxs(View, { style: fieldStyle, children: [
      leftAdornment !== void 0 ? /* @__PURE__ */ jsx(View, { style: { marginRight: s.gap }, children: leftAdornment }) : null,
      /* @__PURE__ */ jsx(
        TextInput,
        {
          ref,
          editable,
          ...rest,
          placeholderTextColor: placeholderTextColor ?? theme.colors.fadedText,
          onFocus: (e) => {
            setFocused(true);
            onFocus == null ? void 0 : onFocus(e);
          },
          onBlur: (e) => {
            setFocused(false);
            onBlur == null ? void 0 : onBlur(e);
          },
          style: StyleSheet.flatten([textInputStyle, inputStyle])
        }
      ),
      rightAdornment !== void 0 ? /* @__PURE__ */ jsx(View, { style: { marginLeft: s.gap }, children: rightAdornment }) : null
    ] }),
    hasError ? /* @__PURE__ */ jsx(Text, { theme, variant: "caption", tone: "error", style: { marginTop: theme.spacing.xs }, children: error }) : hint !== void 0 ? /* @__PURE__ */ jsx(Text, { theme, variant: "caption", tone: "faded", style: { marginTop: theme.spacing.xs }, children: hint }) : null
  ] });
});
const paddingFor = (density, theme) => {
  const s = theme.spacing;
  return density === "compact" ? { paddingV: s.sm, paddingH: s.md, gap: s.sm } : { paddingV: s.md, paddingH: s.lg, gap: s.md };
};
const ListItem = ({
  theme,
  title,
  subtitle,
  leftContent,
  rightContent,
  density = "comfortable",
  selected = false,
  onPress,
  disabled,
  style,
  ...rest
}) => {
  const p = paddingFor(density, theme);
  const pressable = onPress !== void 0 && !disabled;
  const rowStyle = (pressed) => ({
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: p.paddingV,
    paddingHorizontal: p.paddingH,
    backgroundColor: selected ? theme.colors.surfaceHighlight : pressed && pressable ? theme.colors.surfaceAlt : "transparent",
    opacity: disabled ? 0.5 : 1
  });
  const content = /* @__PURE__ */ jsxs(Fragment, { children: [
    leftContent !== void 0 ? /* @__PURE__ */ jsx(View, { style: { marginRight: p.gap }, children: leftContent }) : null,
    /* @__PURE__ */ jsxs(View, { style: { flex: 1 }, children: [
      /* @__PURE__ */ jsx(Text, { theme, variant: "body", tone: "primary", weight: "500", children: title }),
      subtitle !== void 0 ? /* @__PURE__ */ jsx(Text, { theme, variant: "caption", tone: "secondary", style: { marginTop: 2 }, children: subtitle }) : null
    ] }),
    rightContent !== void 0 ? /* @__PURE__ */ jsx(View, { style: { marginLeft: p.gap }, children: rightContent }) : null
  ] });
  if (!pressable) {
    return /* @__PURE__ */ jsx(View, { style: StyleSheet.flatten([rowStyle(false), style]), children: content });
  }
  return /* @__PURE__ */ jsx(
    Pressable,
    {
      ...rest,
      onPress,
      disabled,
      style: ({ pressed }) => StyleSheet.flatten([rowStyle(pressed), style]),
      children: content
    }
  );
};
const sizeToNumber = (size) => {
  switch (size) {
    case "sm":
      return 16;
    case "md":
      return 24;
    case "lg":
      return 36;
  }
};
const toneToColor = (tone, theme) => {
  switch (tone) {
    case "primary":
      return theme.colors.textPrimary;
    case "accent":
      return theme.colors.primary ?? theme.colors.accent;
    case "onAccent":
      return theme.colors.background;
  }
};
const Spinner = ({
  theme,
  size = "md",
  tone = "accent",
  color,
  style
}) => /* @__PURE__ */ jsx(
  ActivityIndicator,
  {
    size: sizeToNumber(size),
    color: color ?? toneToColor(tone, theme),
    style
  }
);
const defaultSpacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32
};
const defaultRadius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  pill: 999
};
const systemFont = Platform.select({ ios: "System", android: "sans-serif", default: "System" });
const systemMono = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });
const defaultTypography = {
  display: { fontFamily: systemFont, fontSize: 32, lineHeight: 38, fontWeight: "700" },
  title: { fontFamily: systemFont, fontSize: 22, lineHeight: 28, fontWeight: "600" },
  body: { fontFamily: systemFont, fontSize: 16, lineHeight: 22, fontWeight: "400" },
  caption: { fontFamily: systemFont, fontSize: 12, lineHeight: 16, fontWeight: "400" },
  mono: { fontFamily: systemMono, fontSize: 14, lineHeight: 20, fontWeight: "400" }
};
const defaultMotion = {
  fast: 120,
  base: 200,
  slow: 320
};
export {
  Button,
  Card,
  Chip,
  Divider,
  Input,
  ListItem,
  Spinner,
  Text,
  defaultMotion,
  defaultRadius,
  defaultSpacing,
  defaultTypography
};
