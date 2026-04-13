import { StyleSheet } from 'react-native';
import { ThemeColors, ThemePalette } from '../../../themes/types';

export const createComponentStyles = (theme: ThemeColors, palette: ThemePalette) =>
    StyleSheet.create({
        sectionHeader: {
            fontSize: 12,
            fontWeight: '600',
            color: theme.fadedText,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginBottom: 6,
            marginTop: 24,
            paddingHorizontal: 4,
        },
        sectionCard: {
            backgroundColor: theme.surface,
            borderRadius: 12,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
            overflow: 'hidden',
        },
        rowContainer: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 13,
            minHeight: 50,
        },
        rowDivider: {
            height: StyleSheet.hairlineWidth,
            backgroundColor: theme.border,
            marginLeft: 16,
        },
        rowLabel: {
            flex: 1,
            fontSize: 16,
            color: theme.textPrimary,
        },
        rowLabelDestructive: {
            flex: 1,
            fontSize: 16,
            color: palette.red,
        },
        rowValue: {
            fontSize: 15,
            color: theme.fadedText,
            marginRight: 6,
            maxWidth: 160,
        },
        rowChevron: {
            color: theme.fadedText,
        },
        toggleLabel: {
            flex: 1,
            fontSize: 16,
            color: theme.textPrimary,
        },
        toggleSubtitle: {
            fontSize: 13,
            color: theme.fadedText,
            marginTop: 1,
        },
        pressedRow: {
            backgroundColor: theme.surfaceHighlight,
        },
    });
