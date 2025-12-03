import { ThemeDescriptor, ThemePalette } from './types';

export const oneDarkPalette: ThemePalette = {
    red: '#e06c75',
    orange: '#d19a66',
    yellow: '#e5c07b',
    green: '#98c379',
    cyan: '#56b6c2',
    blue: '#61afef',
    magenta: '#c678dd',
    black: '#282c34',
    white: '#abb2bf',
    fg: '#abb2bf',
    bg: '#21252b',
    gutterGrey: '#4b5263',
    commentGrey: '#5c6370',
    // Additional colors for chat UI
    background: '#282c34',
    foreground: '#abb2bf',
    currentLine: '#2c323c',
    selection: '#3e4451',
    comment: '#5c6370',
};

export const oneDarkTheme: ThemeDescriptor = {
    id: 'oneDark',
    name: 'One Dark',
    palette: oneDarkPalette,
    colors: {
        attention: oneDarkPalette.red,
        background: oneDarkPalette.background,
        icon: oneDarkPalette.white,
        text: oneDarkPalette.white,
        fadedText: 'rgba(171, 178, 191, 0.7)',
        accent: oneDarkPalette.blue,
        accentAlt: oneDarkPalette.cyan,
        border: oneDarkPalette.gutterGrey,
        textSecondary: oneDarkPalette.commentGrey,
        textPrimary: oneDarkPalette.fg,
        surface: '#2c313a',
        surfaceAlt: '#262b33',
        surfaceHighlight: oneDarkPalette.selection ?? '#3e4451',
    },
};

export const oneDark = oneDarkTheme.colors;
