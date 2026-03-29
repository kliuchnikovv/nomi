export type ThemeName = 'tokyoNight' | 'oneDark' | 'visualStudioLight' | 'serikaDark' | 'retroSunset' | 'retroPastel' | 'deepOcean' | 'darkMinimal';

export type ThemePalette = {
    red: string;
    orange: string;
    yellow: string;
    green: string;
    cyan: string;
    blue: string;
    magenta: string;
    purple: string;  // Added for ActiveTaskCard component
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
    primary?: string;
    error?: string;
    card?: string;
    // Extended semantic colors
    warning?: string;
    success?: string;
    info?: string;
    // Source-specific colors for visual diversity
    calendar?: string;
    email?: string;
    task?: string;
    // Code colors
    codeBg?: string;
    codeInlineBg?: string;
    codeText?: string;
    // Blockquote colors
    blockquoteBg?: string;
    blockquoteBorder?: string;
};

export type ThemeEffects = {
    cardShadowRaised: object;
    cardShadowInset: object;
    cardBorderRadius: number;
    cardPadding: number;
    glassBackground: string;
    glassBorderColor: string;
    glassBorderWidth: number;
    blurIntensity: number;
    blurTint: string;
    buttonShadowRaised: object;
    buttonShadowPressed: object;
    iconBgBackground: string;
    iconBgBorderColor: string;
};

export type ThemeDescriptor = {
    id: ThemeName;
    name: string;
    palette: ThemePalette;
    colors: ThemeColors;
    effects?: ThemeEffects;
};
