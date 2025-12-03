import { StyleSheet } from 'react-native';
import { tokyoNight, tokyoNightPalette } from '../../themes/tokyoNight';

export const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: tokyoNight.background,
        justifyContent: 'center',
        padding: 20,
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        color: tokyoNight.text,
        marginBottom: 32,
        textAlign: 'center',
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
    },
    tabContainer: {
        flexDirection: 'row',
        marginBottom: 32,
        backgroundColor: 'rgba(192, 202, 245, 0.06)',
        borderRadius: 12,
        padding: 4,
    },
    tab: {
        flex: 1,
        paddingVertical: 10,
        alignItems: 'center',
        borderRadius: 10,
    },
    activeTab: {
        backgroundColor: 'rgba(192, 202, 245, 0.1)',
    },
    tabText: {
        color: tokyoNight.fadedText,
        fontWeight: '600',
        fontSize: 14,
    },
    activeTabText: {
        color: tokyoNight.text,
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
    dividerContainer: {
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
