import { StyleSheet } from 'react-native';
import { tokyoNight, tokyoNightTheme } from '../../themes/tokyoNight';

export const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: tokyoNight.background,
        flexDirection: 'row',
        overflow: 'hidden',
    },
    sidebarWrap: {
        width: 320,
        backgroundColor: tokyoNightTheme.palette.bg,
        borderRightWidth: 1,
        borderRightColor: tokyoNight.border,
        zIndex: 2,
        overflow: 'hidden',
    },
    divider: {
        width: 1,
        backgroundColor: tokyoNight.border,
    },
    content: {
        // Ensure chat area expands when sidebars are hidden
        flex: 1,
        backgroundColor: tokyoNight.background,
        position: 'relative',
    },
    rightSidebarWrap: {
        width: 320,
        backgroundColor: tokyoNightTheme.palette.bg,
        borderLeftWidth: 1,
        borderLeftColor: tokyoNight.border,
        zIndex: 2,
        overflow: 'hidden',
    },
    header: {
        height: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(192, 202, 245, 0.1)',
    },
    headerBtn: {
        width: 36,
        height: 36,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerIcon: {
        color: tokyoNightTheme.palette.blue,
        fontSize: 18,
    },
    headerTitle: {
        flex: 1,
        color: tokyoNight.text,
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
    },
    backdrop: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.2)',
    },
    badge: {
        position: 'absolute',
        top: -4,
        right: -4,
        backgroundColor: tokyoNightTheme.palette.red,
        borderRadius: 8,
        minWidth: 16,
        height: 16,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 4,
    },
    badgeText: {
        color: tokyoNightTheme.palette.bg,
        fontSize: 10,
        fontWeight: '600',
    },
});
