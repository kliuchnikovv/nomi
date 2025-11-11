import { StyleSheet } from 'react-native';
import { oneDarkPalette } from '../../themes/oneDark.ts';

export const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    title: {
        fontSize: 24,
        marginBottom: 20,
    },
    input: {
        width: '100%',
        height: 40,
        borderColor: 'gray',
        color: oneDarkPalette.white,
        borderWidth: 1,
        marginBottom: 10,
        paddingHorizontal: 10,
    },
});
