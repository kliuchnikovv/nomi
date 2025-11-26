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
        fontSize: 13,
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
});
