import { StyleSheet } from 'react-native';
import { oneDark, oneDarkPalette } from '../../themes/oneDark.ts';

export const styles = StyleSheet.create({
    root: {
        backgroundColor: oneDarkPalette.black,
        flex: 1,
    },
    sectionHeader: {
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(171, 178, 191, 0.1)',
    },
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    sectionTitle: {
        color: oneDarkPalette.white,
        fontSize: 14,
        fontWeight: '600',
    },
    sectionCount: {
        color: 'rgba(171, 178, 191, 0.7)',
        fontSize: 12,
        marginLeft: 6,
    },
    expandIcon: {
        color: oneDarkPalette.gutterGrey,
    },
    listContent: {
        padding: 8,
        gap: 8,
    },
    filterRow: {
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 4,
    },
    filterChipsRow: {
        flexDirection: 'row',
        gap: 8,
        paddingRight: 8,
    },
    filterChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(171, 178, 191, 0.08)',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(171, 178, 191, 0.1)',
    },
    filterChipActive: {
        backgroundColor: oneDarkPalette.white,
        borderColor: oneDarkPalette.white,
    },
    filterChipContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    filterChipText: {
        color: 'rgba(171, 178, 191, 0.9)',
        fontSize: 12,
        fontWeight: '600',
    },
    filterChipTextActive: {
        color: oneDarkPalette.black,
    },
    inboxItem: {
        padding: 10,
        borderRadius: 8,
        backgroundColor: 'transparent',
        borderLeftWidth: 3,
        borderLeftColor: 'transparent',
    },
    inboxItemUnread: {
        backgroundColor: 'rgba(97, 175, 239, 0.05)',
        borderLeftColor: oneDark.blue,
    },
    inboxHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    sender: {
        color: oneDarkPalette.white,
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 2,
    },
    sourceBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 999,
    },
    sourceBadgeText: {
        fontSize: 11,
        fontWeight: '600',
    },
    timestamp: {
        color: 'rgba(171, 178, 191, 0.6)',
        fontSize: 11,
    },
    subject: {
        color: oneDarkPalette.white,
        fontSize: 13,
        marginBottom: 3,
    },
    preview: {
        color: 'rgba(171, 178, 191, 0.7)',
        fontSize: 12,
        lineHeight: 16,
    },
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    emptyText: {
        color: 'rgba(171, 178, 191, 0.5)',
        fontSize: 14,
        textAlign: 'center',
    },
    structuredContainer: {
        marginTop: 8,
        gap: 8,
    },
    structuredTitle: {
        color: oneDarkPalette.white,
        fontSize: 14,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    badgeRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 8,
        flexWrap: 'wrap',
    },
    badge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        backgroundColor: 'rgba(171, 178, 191, 0.1)',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    badgeText: {
        fontSize: 11,
        color: oneDarkPalette.white,
    },
    summary: {
        color: 'rgba(171, 178, 191, 0.8)',
        fontSize: 13,
        lineHeight: 18,
    },
    actionsContainer: {
        marginTop: 8,
        gap: 6,
    },
    actionButton: {
        backgroundColor: 'rgba(97, 175, 239, 0.1)',
        padding: 8,
        borderRadius: 6,
        alignItems: 'center',
    },
    actionButtonExecuting: {
        opacity: 0.6,
    },
    actionText: {
        color: oneDark.blue,
        fontSize: 12,
        fontWeight: '600',
    },
    actionWhy: {
        color: 'rgba(171, 178, 191, 0.8)',
        fontSize: 11,
        marginTop: 4,
        textAlign: 'center',
    },
    missingInfo: {
        marginTop: 8,
        padding: 8,
        backgroundColor: 'rgba(224, 108, 117, 0.1)',
        borderRadius: 6,
    },
    missingInfoText: {
        color: oneDarkPalette.red,
        fontSize: 12,
    },
    // Стили для плагинов и чатов
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
        color: oneDarkPalette.white,
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
        color: oneDarkPalette.black,
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
        backgroundColor: 'rgba(97, 175, 239, 0.15)',
        borderLeftWidth: 3,
        borderLeftColor: oneDark.blue,
    },
    chatItemUnread: {
        backgroundColor: 'rgba(97, 175, 239, 0.05)',
    },
    chatItemContent: {
        gap: 4,
    },
    chatTitle: {
        color: oneDarkPalette.white,
        fontSize: 13,
        fontWeight: '500',
    },
    chatTitleUnread: {
        fontWeight: '600',
    },
    chatPreview: {
        color: 'rgba(171, 178, 191, 0.7)',
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
        color: 'rgba(171, 178, 191, 0.5)',
        fontSize: 11,
    },
    chatUnreadBadge: {
        backgroundColor: oneDark.blue,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        paddingHorizontal: 5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    chatUnreadBadgeText: {
        color: oneDarkPalette.white,
        fontSize: 10,
        fontWeight: '700',
    },
    messagePanel: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: 'rgba(171, 178, 191, 0.12)',
        padding: 12,
        gap: 8,
    },
    messagePanelTitle: {
        color: oneDarkPalette.white,
        fontSize: 14,
        fontWeight: '700',
    },
    messageCard: {
        backgroundColor: 'rgba(171, 178, 191, 0.04)',
        borderRadius: 8,
        padding: 10,
        gap: 6,
    },
    messageCardTitle: {
        color: oneDarkPalette.white,
        fontSize: 13,
        fontWeight: '600',
    },
    messageCardSummary: {
        color: 'rgba(171, 178, 191, 0.85)',
        fontSize: 12,
        lineHeight: 16,
    },
    messageMetaRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    messageTimestamp: {
        color: 'rgba(171, 178, 191, 0.6)',
        fontSize: 11,
    },
    messageStatus: {
        color: oneDarkPalette.blue,
        fontSize: 11,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    messageEmpty: {
        color: 'rgba(171, 178, 191, 0.6)',
        fontSize: 12,
    },
});
