export const palette = {
    background: '#0C0C10',
    surface: '#111118',
    surfaceAlt: '#14141F',
    border: '#1F1F2C',
    textPrimary: '#E6E7EC',
    textSecondary: '#A6A7AE',
    accent: '#7C8CFF',
    accentAlt: '#6AE6C9',
    userBubble: '#2E3053',
    assistantBubble: '#1A1B2A',
    surfaceHighlight: '#161626',
};

export const ASSISTANT_BUBBLE_WIDTH_RATIO = 0.95;

export const markdownStyles = {
    body: {
        color: palette.textPrimary,
        fontSize: 16,
        lineHeight: 22,
        fontFamily: 'System',
    },
    link: {
        color: palette.accent,
        fontSize: 16,
        fontFamily: 'System',
    },
    bullet_list: {
        color: palette.textPrimary,
        fontSize: 16,
        fontFamily: 'System',
    },
    ordered_list: {
        color: palette.textPrimary,
        fontSize: 16,
        fontFamily: 'System',
    },
    list_item: {
        color: palette.textPrimary,
        fontSize: 16,
        fontFamily: 'System',
    },
    paragraph: {
        color: palette.textPrimary,
        fontSize: 16,
        fontFamily: 'System',
        lineHeight: 22,
    },
    heading1: {
        color: palette.textPrimary,
        fontSize: 22,
        fontFamily: 'System',
        marginBottom: 6,
    },
    heading2: {
        color: palette.textPrimary,
        fontSize: 20,
        fontFamily: 'System',
        marginBottom: 6,
    },
    heading3: {
        color: palette.textPrimary,
        fontSize: 18,
        fontFamily: 'System',
        marginBottom: 4,
    },
    strong: {
        fontWeight: '700',
        color: palette.textPrimary,
        fontSize: 16,
        fontFamily: 'System',
    },
    em: {
        fontStyle: 'italic',
        color: palette.textPrimary,
        fontSize: 16,
        fontFamily: 'System',
    },
    code_inline: {
        backgroundColor: '#1C1C29',
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: 6,
        color: palette.accentAlt,
        fontFamily: 'Courier',
    },
    code_block: {
        backgroundColor: '#1C1C29',
        padding: 8,
        borderRadius: 10,
        color: palette.accentAlt,
        fontFamily: 'Courier',
    },
    fence: {
        backgroundColor: '#1C1C29',
        padding: 8,
        borderRadius: 10,
        color: palette.accentAlt,
        fontFamily: 'Courier',
    },
};
