import { StyleSheet } from 'react-native';
import { theme } from '../../themes';

export const styles = StyleSheet.create({
    root: {
        backgroundColor: theme.background,
        flex: 1,
        justifyContent: 'space-between',
    },
    topBar: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(192, 202, 245, 0.08)',
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
        backgroundColor: 'rgba(192, 202, 245, 0.06)',
    },
    collapseIcon: {
        color: theme.text,
        fontSize: 18,
    },
    newChatBtn: {
        paddingVertical: 10,
        paddingHorizontal: 12,
        backgroundColor: 'rgba(122, 162, 247, 0.15)',
        borderRadius: 8,
    },
    newChatText: {
        color: theme.accent,
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
        backgroundColor: theme.surfaceHighlight,
    },
    chatItemHighlighted: {
        backgroundColor: 'rgba(192, 202, 245, 0.12)',
    },
    chatTitle: {
        color: theme.textPrimary,
        fontSize: 14,
        fontWeight: '600',
    },
    chatTitleActive: {
        color: theme.accent,
    },
    chatSubtitle: {
        color: theme.fadedText,
        fontSize: 12,
        marginTop: 2,
    },
    bottomBar: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: 'rgba(192, 202, 245, 0.08)',
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
        color: theme.accent,
    },
    settingsText: {
        color: theme.text,
        fontSize: 14,
    },
    settingsColor: {
        color: theme.textSecondary,
    }
});
