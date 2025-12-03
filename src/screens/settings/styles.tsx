import { StyleSheet } from 'react-native';
import { tokyoNight, tokyoNightPalette } from '../../themes/tokyoNight';

export const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: tokyoNight.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(192, 202, 245, 0.06)',
    },
    title: {
        color: tokyoNight.text,
        fontSize: 16,
        fontWeight: '700',
    },
    closeBtn: {
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    closeText: {
        color: tokyoNight.fadedText,
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
        color: tokyoNight.fadedText,
        fontSize: 13,
    },
    value: {
        color: tokyoNight.text,
        fontSize: 15,
        marginTop: 4,
    },
    logoutBtn: {
        backgroundColor: tokyoNightPalette.red,
        paddingVertical: 14,
        borderRadius: 16,
        alignItems: 'center',
    },
    connectorsBtn: {
        backgroundColor: tokyoNight.blue,
        paddingVertical: 14,
        borderRadius: 16,
        alignItems: 'center',
    },
    logoutText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
});
