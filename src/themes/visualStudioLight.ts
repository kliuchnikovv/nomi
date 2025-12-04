import { ThemeDescriptor, ThemePalette } from './types';

export const visualStudioLightPalette: ThemePalette = {
    red: '#a31515',
    orange: '#d16969',
    yellow: '#795e26',
    green: '#098658',
    cyan: '#0451a5',
    blue: '#0000ff',
    magenta: '#811f3f',
    white: '#ffffff',
    fg: '#000000',
    black: '#000000',
    bg: '#ffffff',
    gutterGrey: '#f3f3f3',
    commentGrey: '#008000',
    selection: '#add6ff',
    // Additional colors for chat UI
    background: '#ffffff',
    foreground: '#000000',
    currentLine: '#eff284',
    comment: '#008000',
};

export const visualStudioLightTheme: ThemeDescriptor = {
    id: 'visualStudioLight',
    name: 'Light (Visual Studio)',
    palette: visualStudioLightPalette,
    colors: {
        attention: visualStudioLightPalette.red,
        background: visualStudioLightPalette.bg,
        icon: visualStudioLightPalette.fg,
        text: visualStudioLightPalette.fg,
        fadedText: 'rgba(0, 0, 0, 0.7)',
        accent: visualStudioLightPalette.blue,
        accentAlt: visualStudioLightPalette.cyan,
        border: '#e5e5e5', // Lighter border for light theme
        textSecondary: '#666666', // Darker grey for secondary text on light background
        textPrimary: visualStudioLightPalette.fg,
        surface: '#f3f3f3', // Light grey for cards/sidebars
        surfaceAlt: '#e5e5e5',
        surfaceHighlight: '#d4d4d4', // Hover/Active state
    },
};

export const visualStudioLight = visualStudioLightTheme.colors;
