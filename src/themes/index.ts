import { oneDarkTheme } from './oneDark';
import { tokyoNightTheme } from './tokyoNight';
import { visualStudioLightTheme } from './visualStudioLight';
import { ThemeDescriptor, ThemeName } from './types';

export const themes: Record<ThemeName, ThemeDescriptor> = {
    tokyoNight: tokyoNightTheme,
    oneDark: oneDarkTheme,
    visualStudioLight: visualStudioLightTheme,
};

export const defaultThemeName: ThemeName = 'tokyoNight';

export const activeTheme = themes[defaultThemeName];
export const theme = activeTheme.colors;
export const palette = activeTheme.palette;

export type { ThemeColors, ThemeDescriptor, ThemeName, ThemePalette } from './types';
