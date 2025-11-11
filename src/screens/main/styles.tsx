import { StyleSheet } from 'react-native';
import { oneDark } from '../../themes/oneDark.ts';

export const styles = StyleSheet.create({
    root: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: oneDark.background,
    },
    sidebarWrap: {
        overflow: 'hidden',
    },
    divider: {
        width: StyleSheet.hairlineWidth,
        backgroundColor: 'rgba(171, 178, 191, 0.12)',
    },
    content: {
        width: '100%',
        flexShrink: 0,
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
});
