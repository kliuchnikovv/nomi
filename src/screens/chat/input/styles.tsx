import { StyleSheet } from 'react-native';
import { oneDark } from '../../../themes/oneDark.ts';

export const styles = StyleSheet.create({
    container: {
        gap: 6,
    },
    inputWrap: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        backgroundColor: 'rgba(171, 178, 191, 0.06)',
        borderRadius: 16,
        paddingHorizontal: 10,
    },
    input: {
        flex: 1,
        color: oneDark.text,
        fontSize: 16,
        paddingHorizontal: 8,
        paddingVertical: 10,
    },
    iconBtn: {
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconBtnActive: {
        backgroundColor: 'rgba(171, 178, 191, 0.08)',
    },
    iconBtnDisabled: {
        opacity: 0.4,
    },
    sendBtn: {
        marginHorizontal: 4,
        paddingHorizontal: 2,
        paddingVertical: 6,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconText: {
        color: oneDark.text,
        fontSize: 18,
    },
    hint: {
        color: 'rgba(171, 178, 191, 0.6)',
        fontSize: 12,
        textAlign: 'center',
    },
});