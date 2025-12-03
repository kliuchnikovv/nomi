import { StyleSheet } from 'react-native';
import { tokyoNight, tokyoNightPalette } from '../../themes/tokyoNight';

export const styles = StyleSheet.create({
    root: {
        backgroundColor: tokyoNight.background,
        flex: 1,
    },
    sectionHeader: {
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(192, 202, 245, 0.1)',
    },
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    sectionTitle: {
        color: tokyoNightPalette.white,
        fontSize: 14,
        fontWeight: '600',
    },
    sectionCount: {
        color: 'rgba(192, 202, 245, 0.7)',
        fontSize: 12,
        marginLeft: 6,
    },
    expandIcon: {
        color: tokyoNightPalette.gutterGrey,
    },
    listContent: {
        padding: 8,
    },
    fileItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 8,
        borderRadius: 8,
        marginBottom: 4,
    },
    fileItemHovered: {
        backgroundColor: 'rgba(192, 202, 245, 0.05)',
    },
    fileIcon: {
        marginRight: 12,
    },
    fileInfo: {
        flex: 1,
    },
    fileName: {
        color: tokyoNight.text,
        fontSize: 14,
        marginBottom: 2,
    },
    fileMeta: {
        color: tokyoNight.fadedText,
        fontSize: 12,
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
        backgroundColor: 'rgba(192, 202, 245, 0.08)',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(192, 202, 245, 0.1)',
    },
    filterChipActive: {
        backgroundColor: tokyoNightPalette.white,
        borderColor: tokyoNightPalette.white,
    },
    filterChipContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    filterChipText: {
        color: 'rgba(192, 202, 245, 0.9)',
        fontSize: 12,
        fontWeight: '600',
    },
    filterChipTextActive: {
        color: tokyoNightPalette.black,
    },
    inboxItem: {
        padding: 10,
        borderRadius: 8,
        backgroundColor: 'transparent',
        borderLeftWidth: 3,
        borderLeftColor: 'transparent',
    },
    inboxItemUnread: {
        backgroundColor: 'rgba(122, 162, 247, 0.05)',
        borderLeftColor: tokyoNight.blue,
    },
    inboxHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    sender: {
        color: tokyoNightPalette.white,
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
        color: 'rgba(192, 202, 245, 0.6)',
        fontSize: 11,
    },
    subject: {
        color: tokyoNightPalette.white,
        fontSize: 13,
        marginBottom: 3,
    },
    preview: {
        color: 'rgba(192, 202, 245, 0.7)',
        fontSize: 12,
        lineHeight: 16,
    },
    emptyState: {
        padding: 16,
        alignItems: 'center',
    },
    emptyText: {
        color: tokyoNight.fadedText,
        fontSize: 14,
        fontStyle: 'italic',
    },
    // Memory section styles
    memoryItem: {
        backgroundColor: 'rgba(192, 202, 245, 0.03)',
        borderRadius: 8,
        padding: 12,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: 'rgba(192, 202, 245, 0.05)',
    },
    memoryHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
    },
    memoryType: {
        fontSize: 11,
        fontWeight: '600',
        color: tokyoNight.accent,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    memoryDate: {
        fontSize: 11,
        color: tokyoNight.fadedText,
    },
    memoryContent: {
        fontSize: 13,
        color: tokyoNight.text,
        lineHeight: 18,
    },
    memoryFooter: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 8,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: 'rgba(192, 202, 245, 0.05)',
    },
    memoryAction: {
        padding: 4,
    },
    // Artifact section styles
    artifactItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(192, 202, 245, 0.03)',
        borderRadius: 8,
        padding: 10,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: 'rgba(192, 202, 245, 0.05)',
    },
    artifactIcon: {
        width: 32,
        height: 32,
        borderRadius: 6,
        backgroundColor: 'rgba(122, 162, 247, 0.1)',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    artifactInfo: {
        flex: 1,
    },
    artifactName: {
        fontSize: 14,
        fontWeight: '500',
        color: tokyoNight.text,
        marginBottom: 2,
    },
    artifactType: {
        fontSize: 11,
        color: tokyoNight.fadedText,
        textTransform: 'capitalize',
    },
    artifactArrow: {
        marginLeft: 8,
    },
    // Tab styles
    tabContainer: {
        flexDirection: 'row',
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: tokyoNight.border,
        gap: 8,
    },
    tab: {
        flex: 1,
        paddingVertical: 8,
        alignItems: 'center',
        borderRadius: 8,
        backgroundColor: 'transparent',
    },
    activeTab: {
        backgroundColor: 'rgba(192, 202, 245, 0.1)',
    },
    tabText: {
        fontSize: 13,
        fontWeight: '600',
        color: tokyoNight.fadedText,
    },
    activeTabText: {
        color: tokyoNight.text,
    },
    // Search styles
    searchContainer: {
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: tokyoNight.border,
    },
    searchInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(192, 202, 245, 0.06)',
        borderRadius: 8,
        paddingHorizontal: 10,
        height: 36,
    },
    searchIcon: {
        marginRight: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 14,
        color: tokyoNight.text,
        padding: 0,
        height: '100%',
    },
    clearButton: {
        padding: 4,
    },
    // Loading state
    loadingContainer: {
        padding: 24,
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 13,
        color: tokyoNight.fadedText,
    },
    structuredContainer: {
        marginTop: 8,
        gap: 8,
    },
    structuredTitle: {
        color: tokyoNightPalette.white,
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
        backgroundColor: 'rgba(192, 202, 245, 0.1)',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    badgeText: {
        fontSize: 11,
        color: tokyoNightPalette.white,
    },
    summary: {
        color: 'rgba(192, 202, 245, 0.8)',
        fontSize: 13,
        lineHeight: 18,
    },
    actionsContainer: {
        marginTop: 8,
        gap: 6,
    },
    actionButton: {
        backgroundColor: 'rgba(122, 162, 247, 0.1)',
        padding: 8,
        borderRadius: 6,
        alignItems: 'center',
    },
    actionButtonExecuting: {
        opacity: 0.6,
    },
    actionText: {
        color: tokyoNight.blue,
        fontSize: 12,
        fontWeight: '600',
    },
    actionWhy: {
        color: 'rgba(192, 202, 245, 0.8)',
        fontSize: 11,
        marginTop: 4,
        textAlign: 'center',
    },
    missingInfo: {
        marginTop: 8,
        padding: 8,
        backgroundColor: 'rgba(247, 118, 142, 0.1)',
        borderRadius: 6,
    },
    missingInfoText: {
        color: tokyoNightPalette.red,
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
        color: tokyoNightPalette.white,
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
        color: tokyoNightPalette.black,
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
        backgroundColor: 'rgba(122, 162, 247, 0.15)',
        borderLeftWidth: 3,
        borderLeftColor: tokyoNight.blue,
    },
    chatItemUnread: {
        backgroundColor: 'rgba(122, 162, 247, 0.05)',
    },
    chatItemContent: {
        gap: 4,
    },
    chatTitle: {
        color: tokyoNightPalette.white,
        fontSize: 13,
        fontWeight: '500',
    },
    chatTitleUnread: {
        fontWeight: '600',
    },
    chatPreview: {
        color: tokyoNight.fadedText,
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
        color: tokyoNight.fadedText,
        fontSize: 11,
    },
    chatUnreadBadge: {
        backgroundColor: tokyoNight.blue,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        paddingHorizontal: 5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    chatUnreadBadgeText: {
        color: tokyoNightPalette.white,
        fontSize: 10,
        fontWeight: '700',
    },
    messagePanel: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: 'rgba(192, 202, 245, 0.12)',
        padding: 12,
        gap: 8,
    },
    messagePanelTitle: {
        color: tokyoNightPalette.white,
        fontSize: 14,
        fontWeight: '700',
    },
    messageCard: {
        backgroundColor: 'rgba(192, 202, 245, 0.04)',
        borderRadius: 8,
        padding: 10,
        gap: 6,
    },
    messageCardTitle: {
        color: tokyoNightPalette.white,
        fontSize: 13,
        fontWeight: '600',
    },
    messageCardSummary: {
        color: 'rgba(192, 202, 245, 0.85)',
        fontSize: 12,
        lineHeight: 16,
    },
    messageMetaRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    messageTimestamp: {
        color: tokyoNight.fadedText,
        fontSize: 11,
    },
    messageStatus: {
        color: tokyoNight.blue,
        fontSize: 11,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    messageEmpty: {
        color: tokyoNight.fadedText,
        fontSize: 12,
    },
});
