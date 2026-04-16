import { StyleSheet } from 'react-native';
import { ThemeColors, ThemePalette } from '../../themes/types';

export const createStyles = (theme: ThemeColors, palette: ThemePalette) =>
    StyleSheet.create({
        root: {
            flex: 1,
            backgroundColor: theme.background,
        },
        header: {
            paddingHorizontal: 16,
            paddingBottom: 8,
        },
        title: {
            color: theme.textPrimary,
            fontSize: 32,
            fontWeight: '700',
        },
        body: {
            paddingHorizontal: 16,
            paddingTop: 4,
        },
    });
