import { ThemeDescriptor, ThemePalette } from './types';

export const tokyoNightPalette: ThemePalette = {
    red: '#f7768e',
    orange: '#ff9e64',
    yellow: '#e0af68',
    green: '#9ece6a',
    cyan: '#7dcfff',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    white: '#a9b1d6',
    fg: '#c0caf5',
    black: '#414868',
    bg: '#1a1b26',
    gutterGrey: '#3b4261',
    commentGrey: '#565f89',
    selection: '#364a82',
    // Additional colors for chat UI
    background: '#1a1b26',
    foreground: '#c0caf5',
    currentLine: '#292e42',
    comment: '#565f89',
};

export const tokyoNightTheme: ThemeDescriptor = {
    id: 'tokyoNight',
    name: 'Tokyo Night',
    palette: tokyoNightPalette,
    colors: {
        attention: tokyoNightPalette.red,
        background: tokyoNightPalette.bg,
        icon: tokyoNightPalette.fg,
        text: tokyoNightPalette.fg,
        fadedText: 'rgba(192, 202, 245, 0.7)',
        accent: tokyoNightPalette.blue,
        accentAlt: tokyoNightPalette.cyan,
        border: tokyoNightPalette.gutterGrey,
        textSecondary: tokyoNightPalette.commentGrey,
        textPrimary: tokyoNightPalette.fg,
        surface: '#24283b', // Slightly lighter background for cards/sidebars
        surfaceAlt: '#1f2335',
        surfaceHighlight: '#2f3549', // Hover/Active state
    },
};

export const tokyoNight = tokyoNightTheme.colors;
