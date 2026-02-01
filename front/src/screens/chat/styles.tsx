import { StyleSheet } from 'react-native';
import { palette as themePalette } from '../../themes';
import { ThemeColors } from '../../themes/types';
import { createChatTheme } from './theme';

export const createStyles = (theme: ThemeColors) => {
    const chatTheme = createChatTheme(theme);

    return StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: theme.background,
        },
        layout: {
            flex: 1,
            flexDirection: 'row',
        },
        conversation: {
            flex: 1,
            backgroundColor: theme.background,
            position: 'relative',
        },
        header: {
            height: 60,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            // borderBottomWidth: 1, // Remove border for seamless look
            // borderBottomColor: theme.border,
            backgroundColor: theme.background,
        },
        menuButton: {
            padding: 8,
            marginRight: 8,
        },
        headerAvatar: {
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: theme.accent,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 12,
        },
        headerAvatarText: {
            color: themePalette.bg,
            fontSize: 14,
            fontWeight: 'bold',
        },
        headerBody: {
            flex: 1,
            justifyContent: 'center',
        },
        headerTitle: {
            fontSize: 16,
            fontWeight: '600',
            color: theme.text,
        },
        headerSubtitle: {
            fontSize: 12,
            color: theme.fadedText,
            marginTop: 0,
        },
        headerBadge: {
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 12,
            backgroundColor: 'rgba(122, 162, 247, 0.1)', // accent tint
            marginLeft: 8,
        },
        headerBadgeText: {
            fontSize: 10,
            fontWeight: '600',
            color: theme.accent,
        },
        messagesContainer: {
            paddingBottom: 0,
            backgroundColor: theme.background,
        },
        inputToolbarContainer: {
            backgroundColor: theme.background,
            borderTopWidth: 0,
            paddingTop: 0,
            paddingBottom: 0,
        },
        inputToolbarPrimary: {
            alignItems: 'flex-end',
            paddingVertical: 8,
            paddingHorizontal: 12,
        },
        composer: {
            backgroundColor: 'rgba(192, 202, 245, 0.06)', // default opacity based on accent
            borderRadius: 20,
            paddingHorizontal: 12,
            paddingTop: 8,
            paddingBottom: 8,
            fontSize: 16,
            lineHeight: 22,
            color: theme.text,
            marginTop: 0,
            marginBottom: 0,
            marginLeft: 0,
            marginRight: 0,
        },
        actionButton: {
            width: 40,
            height: 44,
            justifyContent: 'center',
            alignItems: 'center',
            marginLeft: 4,
        },
        rightIconsContainer: {
            flexDirection: 'row',
            alignItems: 'center',
            height: 44,
            marginRight: 8,
        },
        iconButton: {
            width: 40,
            height: 44,
            justifyContent: 'center',
            alignItems: 'center',
        },
        sendContainer: {
            justifyContent: 'center',
            alignItems: 'center',
            alignSelf: 'center',
            marginBottom: 0,
            height: 44,
        },
        sendButton: {
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: chatTheme.accent,
            justifyContent: 'center',
            alignItems: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
        },
        arrowUp: {
            width: 0,
            height: 0,
            backgroundColor: 'transparent',
            borderStyle: 'solid',
            borderLeftWidth: 6,
            borderRightWidth: 6,
            borderBottomWidth: 10,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: chatTheme.textPrimary,
            transform: [{ translateY: -1 }],
        },
        footerContainer: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 8,
            paddingBottom: 20,
        },
        typingDot: {
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: chatTheme.accentAlt,
            marginRight: 8,
        },
        footerText: {
            color: chatTheme.textSecondary,
            fontSize: 13,
        },
    });
};
