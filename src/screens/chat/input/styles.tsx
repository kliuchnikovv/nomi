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
        flexDirection: 'column',
        backgroundColor: `${theme.accent}1F`, // Accent color with ~12% opacity
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        paddingHorizontal: 18,
        paddingTop: 12,
        minHeight: 56,
        borderWidth: 1,
        borderColor: `${theme.accent}40`, // Accent color with ~25% opacity
        borderBottomWidth: 0,
    },
    buttonRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 8,
    },
    leftActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flex: 1,
    },
    rightActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    input: {
        color: theme.text,
        fontSize: 16,
        minHeight: 40,
        maxHeight: 100,
        paddingTop: 8,
        paddingBottom: 8,
        paddingHorizontal: 12,
    },
    sendBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: theme.accentAlt,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 0,
        marginBottom: 0,
        borderWidth: 1,
        borderColor: theme.surfaceHighlight,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
    },
    sendBtnPressed: {
        opacity: 0.85,
    },
    iconBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 0,
        backgroundColor: theme.surfaceAlt,
        borderWidth: 1,
        borderColor: theme.surfaceHighlight,
    },
    iconBtnPressed: {
        opacity: 0.85,
    },
    stopBtn: {
        backgroundColor: theme.attention,
    },
    cancelBtn: {
        backgroundColor: theme.attention,
    },
    modelButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: theme.surfaceAlt,
        borderWidth: 1,
        borderColor: theme.surfaceHighlight,
        gap: 8,
        flexShrink: 1, // Allow shrinking
    },
    modelButtonPressed: {
        opacity: 0.85,
    },
    modelButtonIcon: {
        marginRight: 4,
    },
    modelButtonText: {
        color: theme.text,
        fontSize: 14,
        fontWeight: '600',
    },
    iconBtnDisabled: {
        opacity: 0.5,
    },
});
