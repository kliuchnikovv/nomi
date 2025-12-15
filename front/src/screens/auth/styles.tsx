import { StyleSheet } from 'react-native';
import { tokyoNight, tokyoNightTheme } from '../../themes/tokyoNight';

const tokyoNightPalette = tokyoNightTheme.palette;

export const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: tokyoNight.background,
        justifyContent: 'center',
        padding: 20,
    },
    logo: {
        fontSize: 32,
        fontWeight: 'bold',
        color: tokyoNight.text,
        textAlign: 'center',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        color: tokyoNight.fadedText,
        textAlign: 'center',
        marginBottom: 32,
    },
    formContainer: {
        width: '100%',
    },
    label: {
        fontSize: 14,
        color: tokyoNight.text,
        marginBottom: 8,
        marginLeft: 4,
    },
    inputContainer: {
        marginBottom: 16,
    },
    input: {
        backgroundColor: 'rgba(192, 202, 245, 0.06)', // tokyoNightPalette.fg with opacity
        color: tokyoNight.text,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderRadius: 16,
        fontSize: 16,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    inputFocused: {
        borderColor: tokyoNight.accent,
        backgroundColor: 'rgba(122, 162, 247, 0.1)', // tokyoNightPalette.blue with opacity
    },
    button: {
        backgroundColor: tokyoNight.accent,
        paddingVertical: 14,
        borderRadius: 16,
        alignItems: 'center',
        marginTop: 8,
    },
    buttonPressed: {
        opacity: 0.8,
    },
    buttonText: {
        color: tokyoNightPalette.bg, // Dark text on bright button
        fontSize: 16,
        fontWeight: '600',
    },
    switchButton: {
        marginTop: 24,
        alignItems: 'center',
    },
    switchButtonText: {
        color: tokyoNight.accent,
        fontSize: 14,
        fontWeight: '600',
    },
    googleButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(192, 202, 245, 0.06)',
        paddingVertical: 14,
        borderRadius: 16,
        marginTop: 16,
        borderWidth: 1,
        borderColor: 'rgba(192, 202, 245, 0.1)',
    },
    divider: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 24,
    },
    dividerLine: {
        flex: 1,
        height: 1,
        backgroundColor: 'rgba(192, 202, 245, 0.1)',
    },
    dividerText: {
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        borderWidth: 1,
        borderColor: 'rgba(192, 202, 245, 0.15)',
    },
    googleButtonPressed: {
        backgroundColor: 'rgba(192, 202, 245, 0.1)',
    },
    googleIcon: {
        width: 20,
        height: 20,
        marginRight: 12,
    },
    googleButtonText: {
        marginLeft: 12,
        fontSize: 16,
        color: tokyoNightPalette.fg,
        fontWeight: '600',
    },
});
