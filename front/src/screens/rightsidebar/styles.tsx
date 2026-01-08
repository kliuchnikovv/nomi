import { StyleSheet } from 'react-native';
import { ThemeColors, ThemePalette } from '../../themes/types';

export const createRightSidebarStyles = (theme: ThemeColors, palette: ThemePalette) => StyleSheet.create({
    root: {
        flex: 1,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.border,
    },
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    sectionTitle: {
        color: theme.textPrimary,
        fontSize: 14,
        fontWeight: '600',
    },
    sectionCount: {
        color: theme.textSecondary,
        fontSize: 12,
        marginLeft: 6,
    },
    expandIcon: {
        color: theme.textSecondary,
    },
    listContent: {
        padding: 8,
    },
    emptyState: {
        padding: 16,
        alignItems: 'center',
    },
    emptyText: {
        color: theme.fadedText,
        fontSize: 14,
        fontStyle: 'italic',
    },
    // Plugin section styles
    pluginsList: {
        padding: 8,
    },
    pluginSection: {
        marginBottom: 4,
    },
    pluginHeader: {
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    pluginHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    pluginHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flex: 1,
        minWidth: 0,
    },
    pluginName: {
        color: theme.textPrimary,
        fontSize: 13,
        fontWeight: '600',
        flexShrink: 1,
    },
    unreadBadge: {
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        paddingHorizontal: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    unreadBadgeText: {
        color: palette.black,
        fontSize: 10,
        fontWeight: '700',
    },
    chatsList: {
        paddingLeft: 12,
        paddingRight: 8,
        gap: 2,
    },
    chatItem: {
        padding: 10,
        borderRadius: 6,
        backgroundColor: 'transparent',
        marginBottom: 2,
    },
    chatItemSelected: {
        backgroundColor: `${theme.accent}15`,
        borderLeftWidth: 3,
        borderLeftColor: theme.accent,
    },
    chatItemUnread: {
        backgroundColor: `${theme.accent}08`,
    },
    chatItemContent: {
        gap: 4,
    },
    chatTitle: {
        color: theme.textPrimary,
        fontSize: 13,
        fontWeight: '500',
    },
    chatTitleUnread: {
        fontWeight: '600',
    },
    chatPreview: {
        color: theme.fadedText,
        fontSize: 12,
        lineHeight: 16,
    },
    chatFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 2,
    },
    chatTimestamp: {
        color: theme.fadedText,
        fontSize: 11,
    },
    chatUnreadBadge: {
        backgroundColor: theme.accent,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        paddingHorizontal: 5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    chatUnreadBadgeText: {
        color: theme.textPrimary,
        fontSize: 10,
        fontWeight: '700',
    },
});

export type RightSidebarStyles = ReturnType<typeof createRightSidebarStyles>;
