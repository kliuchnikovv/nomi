import { StyleSheet } from 'react-native';
import { ThemeColors } from '../../../themes/types';

export const createSidebarStyles = (theme: ThemeColors) => StyleSheet.create({
    container: {
        height: '100%',
        backgroundColor: theme.surface,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: theme.border,
        borderTopRightRadius: 24,
        borderBottomRightRadius: 24,
        // paddingTop: 12, // Removed for alignment
        paddingBottom: 12,
        paddingHorizontal: 12,
    },
    overlayRoot: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'flex-start',
    },
    overlayBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(12, 12, 16, 0.75)',
    },
    overlayCard: {
        height: '100%',
        backgroundColor: theme.surface,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: theme.border,
        borderTopRightRadius: 24,
        borderBottomRightRadius: 24,
        // paddingTop: 16, // Removed for alignment
        paddingBottom: 16,
        paddingHorizontal: 12,
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 12,
        elevation: 8,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
        height: 60,
        gap: 12,
    },
    title: {
        color: theme.textPrimary,
        fontSize: 16,
        fontWeight: '600',
    },
    searchContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.surfaceHighlight,
        borderRadius: 24,
        paddingHorizontal: 12,
        paddingVertical: 8, // reduced vertical
        gap: 8,
        height: 40,
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
        color: theme.textPrimary,
        padding: 0,
        margin: 0,
    },
    newChatButton: {
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: theme.accent,
    },
    newChatText: {
        color: theme.background,
        fontWeight: '700',
        fontSize: 13,
    },
    filterBar: {
        marginBottom: 12,
        flexGrow: 0,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.border,
        paddingBottom: 12, // Move marginBottom to paddingBottom to include border
    },
    filterContent: {
        paddingHorizontal: 16,
        paddingRight: 32,
        gap: 24,
    },
    filterItem: {
        paddingVertical: 6,
    },
    filterText: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.textSecondary,
    },
    filterTextActive: {
        color: theme.accent,
    },
    showMoreButton: {
        paddingVertical: 12,
        alignItems: 'center',
    },
    showMoreText: {
        color: theme.accent,
        fontWeight: '600',
        fontSize: 13,
    },
    list: {
        marginHorizontal: -4,
    },
    listContent: {
        paddingBottom: 12,
    },
    item: {
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 12,
    },
    itemActive: {
        backgroundColor: theme.surfaceHighlight,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.border,
    },
    itemHighlighted: {
        backgroundColor: `${theme.accent}15`,
    },
    itemTitle: {
        color: theme.textPrimary,
        fontWeight: '600',
        fontSize: 14,
    },
    itemSubtitle: {
        color: theme.textSecondary,
        fontSize: 12,
        marginTop: 4,
    },
    footer: {
        marginTop: 'auto',
        paddingTop: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.border,
    },
    settingsButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 12,
        backgroundColor: 'transparent',
    },
    settingsButtonPressed: {
        backgroundColor: theme.surfaceHighlight,
    },
    settingsText: {
        color: theme.textPrimary,
        fontSize: 14,
        fontWeight: '600',
        marginLeft: 12,
    },
    separator: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.border,
        // marginLeft: 16, // Optional: match padding or inset 
    },
});
