import { StyleSheet } from 'react-native';
import { ThemeColors, ThemePalette } from '../../themes/types';

export const createStyles = (theme: ThemeColors, palette: ThemePalette) =>
    StyleSheet.create({
        root: {
            flex: 1,
            backgroundColor: theme.background,
        },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.border,
        },
        title: {
            color: theme.text,
            fontSize: 16,
            fontWeight: '700',
        },
        closeBtn: {
            paddingHorizontal: 8,
            paddingVertical: 4,
        },
        closeText: {
            color: theme.fadedText,
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
            color: theme.fadedText,
            fontSize: 13,
        },
        value: {
            color: theme.text,
            fontSize: 15,
            marginTop: 4,
        },
        logoutBtn: {
            backgroundColor: palette.red,
            paddingVertical: 14,
            borderRadius: 16,
            alignItems: 'center',
        },
        connectorsBtn: {
            backgroundColor: theme.accent,
            paddingVertical: 14,
            borderRadius: 16,
            alignItems: 'center',
        },
        logoutText: {
            color: '#fff',
            fontSize: 16,
            fontWeight: '600',
        },
        themeOption: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 12,
            marginBottom: 8,
        },
        themeOptionSelected: {
            backgroundColor: theme.surfaceHighlight,
            borderWidth: 2,
            borderColor: theme.accent,
        },
        themeOptionUnselected: {
            backgroundColor: theme.surface,
            borderWidth: 2,
            borderColor: 'transparent',
        },
        themeOptionText: {
            color: theme.textPrimary,
            fontSize: 15,
            fontWeight: '500',
        },
        themeCheckmark: {
            color: theme.accent,
            fontSize: 18,
            fontWeight: '700',
        },
        themeHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: 8,
        },
        themeCurrentValue: {
            color: theme.textPrimary,
            fontSize: 15,
            marginTop: 4,
            fontWeight: '500',
        },
        chevron: {
            color: theme.fadedText,
            fontSize: 14,
        },
    });
