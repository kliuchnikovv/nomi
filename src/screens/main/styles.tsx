import { StyleSheet } from 'react-native';
import { oneDark } from '../../themes/oneDark.ts';

export const styles = StyleSheet.create({
    root: {
        flex: 1,
        flexDirection: 'row',
        // backgroundColor: oneDark.background,
        backgroundColor:'#0C0C10',
        overflow: 'hidden',
    },
    sidebarWrap: {
        overflow: 'hidden',
        zIndex: 10,
    },
    divider: {
        width: StyleSheet.hairlineWidth,
        backgroundColor: 'rgba(171, 178, 191, 0.12)',
    },
    content: {
        // Ensure chat area expands when sidebars are hidden
        flex: 1,
    },
    rightSidebarWrap: {
        overflow: 'hidden',
        zIndex: 10,
    },
    header: {
        height: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(171, 178, 191, 0.1)',
    },
    headerBtn: {
        width: 36,
        height: 36,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerIcon: {
        color: oneDark.blue,
        fontSize: 18,
    },
    headerTitle: {
        flex: 1,
        color: oneDark.text,
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
        backgroundColor: '#E06C75',
        borderRadius: 8,
        minWidth: 16,
        height: 16,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 4,
    },
    badgeText: {
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: '600',
    },
});
