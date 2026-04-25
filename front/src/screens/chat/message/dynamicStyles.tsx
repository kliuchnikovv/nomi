import { StyleSheet, Dimensions } from 'react-native';
import { ThemeColors, ThemePalette } from '../../../themes';

const withAlpha = (hex: string, alpha: number) => {
    const h = hex.replace('#', '');
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Cache for styles to avoid recreating on every render
const stylesCache = new Map<string, ReturnType<typeof StyleSheet.create>>();
const markdownStylesCache = new Map<string, ReturnType<typeof createMarkdownStyles>>();

// Generate cache key from theme properties
const getThemeCacheKey = (theme: ThemeColors, palette: ThemePalette): string => {
    return `${theme.id || 'default'}-${palette.id || 'default'}`;
};

// Create styles based on theme with caching
export const createStyles = (theme: ThemeColors, palette: ThemePalette) => {
    const cacheKey = getThemeCacheKey(theme, palette);
    const cached = stylesCache.get(cacheKey);
    if (cached) return cached;

    const tokens = {
        userBubble: palette.gutterGrey,
        actionBg: withAlpha(palette.blue, 0.12),
        actionBorder: withAlpha(palette.blue, 0.3),
        actionLabel: theme.text,
        actionWhy: withAlpha(palette.white, 0.7),
        importanceBg: withAlpha(palette.red, 0.15),
        importanceText: palette.red,
        daemonBorder: withAlpha(palette.red, 0.4),
        daemonHeader: palette.red,
    };

    return StyleSheet.create({
        container: {
            flexDirection: 'row',
            marginVertical: 4,
            paddingHorizontal: 16,
        },
        avatar: {
            width: 32,
            height: 32,
            borderRadius: 16,
            marginRight: 8,
            backgroundColor: theme.surfaceHighlight,
            alignItems: 'center',
            justifyContent: 'center',
        },
        bubble: {
            maxWidth: '80%',
            padding: 12,
            borderRadius: 16,
        },
        userBubble: {
            backgroundColor: theme.surfaceHighlight,
            alignSelf: 'flex-end',
            borderBottomRightRadius: 4,
        },
        assistantBubble: {
            backgroundColor: theme.surfaceHighlight,
            alignSelf: 'flex-start',
            borderBottomLeftRadius: 4,
        },
        systemBubble: {
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            alignSelf: 'center',
            borderRadius: 12,
            marginVertical: 8,
            paddingVertical: 8,
            paddingHorizontal: 16,
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.1)',
        },
        text: {
            fontSize: 16,
            lineHeight: 24,
        },
        userText: {
            color: palette.bg,
        },
        assistantText: {
            color: theme.textPrimary,
        },
        time: {
            fontSize: 11,
            marginTop: 4,
            alignSelf: 'flex-end',
        },
        userTime: {
            color: 'rgba(255, 255, 255, 0.7)',
        },
        assistantTime: {
            color: theme.textSecondary,
        },
        importanceBadge: {
            alignSelf: 'flex-start',
            backgroundColor: tokens.importanceBg,
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 6,
            marginTop: 6,
        },
        importanceText: {
            color: tokens.importanceText,
            fontSize: 12,
            fontWeight: '700',
            textTransform: 'uppercase',
        },
        actionButton: {
            backgroundColor: tokens.actionBg,
            padding: 10,
            borderRadius: 8,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: tokens.actionBorder,
        },
        actionWhy: {
            color: tokens.actionWhy,
            fontSize: 12,
            marginTop: 2,
        },
        actionLabel: {
            color: tokens.actionLabel,
            fontSize: 14,
            fontWeight: '600',
        },
        toolCallsContainer: {
            marginTop: 8,
            backgroundColor: withAlpha(palette.blue, 0.08),
            borderRadius: 8,
            overflow: 'hidden',
        },
        toolCallsHeader: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 10,
        },
        toolCallsHeaderText: {
            color: theme.textPrimary,
            fontSize: 13,
            fontWeight: '600',
        },
        toolCallsExpandIcon: {
            color: theme.textSecondary,
            fontSize: 12,
        },
        toolCallsList: {
            paddingHorizontal: 10,
            paddingBottom: 10,
        },
        toolCallItem: {
            backgroundColor: withAlpha(palette.bg, 0.3),
            borderRadius: 6,
            padding: 8,
            marginTop: 6,
        },
        toolCallName: {
            color: theme.accent,
            fontSize: 13,
            fontWeight: '600',
            marginBottom: 4,
        },
        toolCallArgs: {
            color: theme.codeText || '#a9b1d6',
            fontSize: 12,
            fontFamily: 'Menlo',
            lineHeight: 18,
        },
        modelText: {
            color: theme.textSecondary,
            fontSize: 11,
            marginTop: 6,
            fontStyle: 'italic',
        },
        daemonHeader: {
            color: tokens.daemonHeader,
            fontWeight: 'bold',
            marginBottom: 4,
        },
        bubbleDaemon: {
            backgroundColor: withAlpha(tokens.daemonHeader, 0.1),
            alignSelf: 'center',
            maxWidth: '90%',
            borderRadius: 16,
            padding: 12,
        },
        // Inline single tool call styles
        singleToolCallContainer: {
            marginVertical: 6,
            backgroundColor: withAlpha(palette.blue, 0.08),
            borderRadius: 8,
            overflow: 'hidden',
        },
        singleToolCallHeader: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: 6,
            paddingHorizontal: 10,
        },
        singleToolCallName: {
            color: palette.blue,
            fontSize: 12,
            fontWeight: '600',
        },
        singleToolCallDetails: {
            paddingHorizontal: 10,
            paddingBottom: 8,
        },
        toolCallScrollable: {
            maxHeight: 200,
            backgroundColor: theme.codeBg || withAlpha(palette.bg, 0.5),
            borderRadius: 6,
            padding: 8,
            borderWidth: 1,
            borderColor: withAlpha(theme.textSecondary, 0.15),
        },
        // Reasoning block styles
        reasoningContainer: {
            marginVertical: 6,
            backgroundColor: withAlpha(palette.magenta, 0.08),
            borderRadius: 8,
            overflow: 'hidden',
        },
        reasoningHeader: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: 6,
            paddingHorizontal: 10,
        },
        reasoningHeaderText: {
            color: palette.magenta,
            fontSize: 12,
            fontWeight: '600',
        },
        reasoningContent: {
            paddingHorizontal: 10,
            paddingBottom: 8,
        },
        reasoningText: {
            color: theme.textPrimary,
            fontSize: 13,
            lineHeight: 18,
            fontStyle: 'italic',
        },
        // Agent thinking block styles (for team member agent responses as collapsible "thinking")
        agentThinkingContainer: {
            marginVertical: 6,
            backgroundColor: withAlpha(palette.purple || palette.magenta, 0.08),
            borderRadius: 8,
            overflow: 'hidden',
        },
        agentThinkingHeader: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: 6,
            paddingHorizontal: 10,
        },
        agentThinkingHeaderText: {
            color: palette.purple || palette.magenta,
            fontSize: 12,
            fontWeight: '600',
        },
        agentThinkingContent: {
            paddingHorizontal: 10,
            paddingBottom: 8,
        },
        // Legacy member response styles (kept for backward compatibility)
        memberResponseContainer: {
            marginVertical: 6,
            backgroundColor: withAlpha(palette.purple || palette.magenta, 0.08),
            borderRadius: 8,
            overflow: 'hidden',
        },
        memberResponseHeader: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: 6,
            paddingHorizontal: 10,
        },
        memberResponseHeaderText: {
            color: palette.purple || palette.magenta,
            fontSize: 12,
            fontWeight: '700',
        },
        memberResponseContent: {
            paddingHorizontal: 10,
            paddingBottom: 8,
        },
        memberResponseText: {
            color: theme.textPrimary,
            fontSize: 15,
            lineHeight: 22,
        },
        // Collapsible steps styles - now theme-aware!
        collapsibleStepsContainer: {
            marginTop: 8,
            backgroundColor: theme.surfaceHighlight,
            borderRadius: 8,
            overflow: 'hidden',
            minWidth: Dimensions.get('window').width * 0.9, // Force expansion to ~90% of screen
            alignSelf: 'stretch',
        },
        collapsibleStepsHeader: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 10,
        },
        collapsibleStepsHeaderText: {
            color: theme.textPrimary,
            fontSize: 13,
            fontWeight: '600',
        },
        collapsibleStepsContent: {
            paddingHorizontal: 10,
            paddingBottom: 10,
        },
        // Document block styles
        documentContainer: {
            marginVertical: 8,
            borderRadius: 8,
            backgroundColor: theme.surfaceHighlight,
            borderWidth: 1,
            borderColor: withAlpha(theme.textSecondary, 0.1),
            overflow: 'hidden',
        },
        documentHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 12,
            backgroundColor: withAlpha(theme.accent, 0.15), // Highlighted header
            borderBottomWidth: 1,
            borderBottomColor: withAlpha(theme.accent, 0.1),
        },
        documentTitle: {
            fontSize: 14,
            fontWeight: 'bold',
            color: theme.accent, // Highlighted text
        },
        documentChevron: {
            fontSize: 12,
            color: theme.textSecondary,
        },
        documentBody: {
            padding: 12,
            backgroundColor: theme.codeBg || '#1a1b26',
        },
        agentLabel: {
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 4,
            marginLeft: 4,
        },
        agentLabelText: {
            fontSize: 11,
            fontWeight: '600',
            color: theme.textSecondary,
        },
        locationContainer: {
            marginTop: 8,
            gap: 6,
        },
        locationPill: {
            flexDirection: 'row',
            alignItems: 'flex-start',
            backgroundColor: 'rgba(52, 168, 83, 0.15)',
            borderRadius: 10,
            padding: 8,
            gap: 8,
        },
        locationTitle: {
            fontSize: 13,
            fontWeight: '600',
        },
        locationCoords: {
            fontSize: 11,
        },
    });

    // Cache the result (limit cache size to prevent memory leaks)
    if (stylesCache.size > 10) {
        const firstKey = stylesCache.keys().next().value;
        stylesCache.delete(firstKey);
    }
    stylesCache.set(cacheKey, styles);
    return styles;
};

// Markdown styles - theme-aware with caching
export const createMarkdownStyles = (theme: ThemeColors) => {
    // Simple cache key based on theme id or fallback
    const cacheKey = theme.id || theme.name || JSON.stringify({
        textPrimary: theme.textPrimary,
        codeBg: theme.codeBg,
        codeText: theme.codeText,
    });

    const cached = markdownStylesCache.get(cacheKey);
    if (cached) return cached;

    const styles = {
        body: {
            color: theme.textPrimary,
            fontSize: 16,
            lineHeight: 24,
        },
        link: {
            color: theme.accent,
            textDecorationLine: 'underline',
        },
        link_container: {
            flexDirection: 'row',
            alignItems: 'baseline',
            flexShrink: 1,
        },
        link_icon: {
            color: theme.accent,
            fontSize: 13,
        },
        code_inline: {
            backgroundColor: theme.codeInlineBg || '#24283b',
            paddingHorizontal: 6,
            paddingVertical: 1,
            borderRadius: 6,
            overflow: 'hidden',
            fontFamily: 'Menlo',
            fontSize: 12,
            color: theme.codeText || '#a9b1d6',
            borderColor: withAlpha(theme.codeText || '#a9b1d6', 0.1),
            borderWidth: 0.5,
        },
        code_block: {
            backgroundColor: theme.codeBg || '#1a1b26',
            padding: 12,
            borderRadius: 16,
            marginVertical: 8,
            overflow: 'hidden',
            fontFamily: 'Menlo',
            fontSize: 13,
            color: theme.codeText || '#a9b1d6',
            borderColor: withAlpha(theme.codeText || '#a9b1d6', 0.1),
            borderWidth: 1,
        },
        blockquote: {
            backgroundColor: theme.blockquoteBg || theme.surfaceAlt,
            borderLeftWidth: 3,
            borderLeftColor: theme.blockquoteBorder || theme.accent,
            paddingLeft: 8,
            paddingVertical: 4,
            marginVertical: 4,
            borderRadius: 4,
            color: theme.textPrimary,
        },
        heading1: {
            fontSize: 22,
            fontWeight: '600'
        },
        heading2: {
            fontSize: 20,
            fontWeight: '600'
        },
        bullet_list: {
            marginTop: 4,
            marginBottom: 4,
            color: theme.textPrimary,
        },
        ordered_list: {
            marginTop: 4,
            marginBottom: 4,
            color: theme.textPrimary,
        },
        list_item: {
            marginTop: 2,
            marginBottom: 2,
            flexDirection: 'row',
            flexWrap: 'wrap',
            width: '100%',
            color: theme.textPrimary,
        },
        bullet_list_icon: {
            marginRight: 8,
            color: theme.textPrimary,
        },
        bullet_list_content: {
            flex: 1,
            flexShrink: 1,
            color: theme.textPrimary,
        },
        ordered_list_icon: {
            marginRight: 8,
            color: theme.textPrimary,
        },
        ordered_list_content: {
            flex: 1,
            flexShrink: 1,
            color: theme.textPrimary,
        },
        paragraph: {
            marginTop: 4,
            marginBottom: 4,
            color: theme.textPrimary,
            fontSize: 16,
            lineHeight: 24,
        },
        fence: {
            backgroundColor: theme.codeBg || '#1a1b26',
            padding: 12,
            borderRadius: 8,
            marginVertical: 8,
            fontFamily: 'Menlo',
            fontSize: 14,
            color: theme.codeText || '#a9b1d6',
        },
        table: {
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 8,
        },
        tr: {
            backgroundColor: theme.background,
            borderBottomWidth: 1,
            borderColor: theme.border,
            flexDirection: 'row',
        },
        th: {
            flex: 1,
            padding: 5,
            fontWeight: 'bold',
            color: theme.textPrimary,
        },
        td: {
            flex: 1,
            padding: 5,
            color: theme.textPrimary,
        },
    };

    // Cache the result (limit cache size)
    if (markdownStylesCache.size > 10) {
        const firstKey = markdownStylesCache.keys().next().value;
        markdownStylesCache.delete(firstKey);
    }
    markdownStylesCache.set(cacheKey, styles);
    return styles;
};
