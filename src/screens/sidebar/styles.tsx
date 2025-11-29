import { StyleSheet } from 'react-native';
import { oneDark, oneDarkPalette } from '../../themes/oneDark.ts';

export const styles = StyleSheet.create({
    root: {
        backgroundColor: oneDarkPalette.black,
        flex: 1,
        justifyContent: 'space-between',
    },
    topBar: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(171, 178, 191, 0.1)',
    },
    topBarRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 6,
    },
    collapseBtn: {
        width: 36,
        height: 36,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(171, 178, 191, 0.06)',
    },
    collapseIcon: {
        color: oneDarkPalette.white,
        fontSize: 18,
    },
    newChatBtn: {
        paddingVertical: 10,
        paddingHorizontal: 12,
        backgroundColor: 'rgba(97, 175, 239, 0.15)',
        borderRadius: 8,
    },
    newChatText: {
        color: oneDark.blue,
        fontSize: 14,
    },
    listContent: {
        padding: 8,
        gap: 8,
    },
    chatItem: {
        padding: 10,
        borderRadius: 8,
        backgroundColor: 'transparent',
    },
    chatItemActive: {
        backgroundColor: oneDark.gutterGrey,
    },
    chatItemHighlighted: {
        backgroundColor: 'rgba(171, 178, 191, 0.2)',
    },
    chatTitle: {
        color: oneDarkPalette.white,
        fontSize: 14,
        fontWeight: '600',
    },
    chatTitleActive: {
        color: oneDarkPalette.blue,
    },
    chatSubtitle: {
        color: 'rgba(171, 178, 191, 0.7)',
        fontSize: 12,
        marginTop: 2,
    },
    bottomBar: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: 'rgba(171, 178, 191, 0.1)',
        padding: 8,
    },
    settingsBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: 10,
        borderRadius: 8,
    },
    settingsIcon: {
        fontSize: 16,
        color: oneDark.blue,
    },
    settingsText: {
        color: oneDarkPalette.white,
        fontSize: 14,
    },
    settingsColor: {
        color: oneDarkPalette.gutterGrey,
    }
});
