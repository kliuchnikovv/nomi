import { StyleSheet } from 'react-native';
import { oneDarkPalette } from '../../themes/oneDark.ts';

export const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: oneDarkPalette.black,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(171, 178, 191, 0.06)',
    },
    title: {
        color: oneDarkPalette.white,
        fontSize: 16,
        fontWeight: '700',
    },
    closeBtn: {
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    closeText: {
        color: 'rgba(171, 178, 191, 0.8)',
        fontSize: 14,
    },
    body: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    label: {
        color: 'rgba(171, 178, 191, 0.7)',
        fontSize: 13,
    },
    value: {
        color: oneDarkPalette.white,
        fontSize: 15,
        marginTop: 4,
    },
    logoutBtn: {
        backgroundColor: '#ff4d4f',
        paddingVertical: 10,
        borderRadius: 8,
        alignItems: 'center',
    },
    logoutText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '600',
    },
});
