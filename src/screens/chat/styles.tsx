import { StyleSheet } from 'react-native';
import { oneDark } from '../../themes/oneDark.ts';

export const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    list: {
        flex: 1,
    },
    listContent: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 12,
        gap: 8,
    },
    bubble: {
        padding: 12,
        borderRadius: 12,
        maxWidth: '85%',
        flexDirection: 'row',
        alignItems: 'flex-end',
    },
    bubbleUser: {
        alignSelf: 'flex-end',
        backgroundColor: oneDark.gutterGrey,
    },
    bubbleAssistant: {
        alignSelf: 'flex-start',
        backgroundColor: 'rgba(171, 178, 191, 0.06)',
    },
    bubbleText: {
        color: oneDark.text,
        fontSize: 16,
        lineHeight: 22,
    },
    inputBar: {
        paddingHorizontal: 12,
        paddingBottom: 12,
        paddingTop: 0,
    },
});
