export type ThemeName = 'tokyoNight' | 'oneDark' | 'visualStudioLight' | 'serikaDark';

export type ThemePalette = {
    red: string;
    orange: string;
    yellow: string;
    green: string;
    cyan: string;
    blue: string;
    magenta: string;
    white: string;
    fg: string;
    black: string;
    bg: string;
    gutterGrey: string;
    commentGrey: string;
    selection?: string;
    background: string;
    foreground: string;
    currentLine?: string;
    comment?: string;
};

export type ThemeColors = {
    attention: string;
    background: string;
    icon: string;
    text: string;
    fadedText: string;
    accent: string;
    accentAlt: string;
    border: string;
    textSecondary: string;
    textPrimary: string;
    surface: string;
    surfaceAlt: string;
    surfaceHighlight: string;
};

export type ThemeDescriptor = {
    id: ThemeName;
    name: string;
    palette: ThemePalette;
    colors: ThemeColors;
};
