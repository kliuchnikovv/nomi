import { StyleSheet } from 'react-native';
import { palette } from '../../../themes';
import { ThemeColors } from '../../../themes/types';

export const createStyles = (theme: ThemeColors) => StyleSheet.create({
    container: {
        paddingHorizontal: 0,
        paddingVertical: 0,
        backgroundColor: 'transparent',
    },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        backgroundColor: `${theme.accent}1F`, // Accent color with ~12% opacity
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        paddingHorizontal: 18,
        paddingVertical: 12,
        minHeight: 56,
        borderWidth: 1,
        borderColor: `${theme.accent}40`, // Accent color with ~25% opacity
        borderBottomWidth: 0,
    },
    input: {
        flex: 1,
        color: theme.text,
        fontSize: 16,
        maxHeight: 100,
        paddingTop: 8,
        paddingBottom: 8,
        paddingHorizontal: 8,
    },
    sendBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: theme.accent,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
        marginLeft: 2,
        marginBottom: 2,
    },
    iconBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 2,
    },
    iconBtnActive: {
        backgroundColor: 'rgba(192, 202, 245, 0.1)',
    },
    iconBtnDisabled: {
        opacity: 0.5,
    },
});
