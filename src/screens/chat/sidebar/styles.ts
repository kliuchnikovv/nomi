import { StyleSheet } from 'react-native';
import { palette } from '../theme';

export const styles = StyleSheet.create({
    container: {
        height: '100%',
        backgroundColor: palette.surface,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: palette.border,
        paddingTop: 12,
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
        backgroundColor: palette.surface,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: palette.border,
        paddingTop: 16,
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
    },
    title: {
        color: palette.textPrimary,
        fontSize: 16,
        fontWeight: '700',
    },
    newChatButton: {
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: palette.accent,
    },
    newChatText: {
        color: palette.background,
        fontWeight: '700',
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
        backgroundColor: palette.surfaceHighlight,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border,
    },
    itemTitle: {
        color: palette.textPrimary,
        fontWeight: '600',
        fontSize: 14,
    },
    itemSubtitle: {
        color: palette.textSecondary,
        fontSize: 12,
        marginTop: 4,
    },
});
