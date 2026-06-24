import { StyleSheet } from 'react-native';
import { ThemeColors } from '../../../themes/types';

export const createStyles = (theme: ThemeColors) =>
    StyleSheet.create({
        container: {
            paddingHorizontal: 12,
            paddingTop: 4,
            paddingBottom: 8,
            backgroundColor: 'transparent',
        },
        optionsRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
        },
        inputRow: {
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 8,
        },
        inputPill: {
            flex: 1,
            backgroundColor: theme.surface,
            borderRadius: 22,
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 12,
            color: theme.text,
            fontSize: 16,
            minHeight: 44,
            maxHeight: 120,
        },
        circleBtn: {
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: theme.surface,
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
        },
        circleBtnPressed: {
            opacity: 0.7,
        },
        circleBtnDisabled: {
            opacity: 0.4,
        },
        stopCircle: {
            backgroundColor: '#e74c3c',
        },
        sendCircle: {
            backgroundColor: theme.accentAlt,
        },
        modelPill: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            height: 44,
            borderRadius: 22,
            backgroundColor: theme.surface,
            flexShrink: 1,
        },
        modelPillText: {
            color: theme.text,
            fontSize: 14,
            fontWeight: '600',
        },
        modelPillPressed: {
            opacity: 0.7,
        },
        thinkBadge: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 10,
            height: 28,
            borderRadius: 14,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.accentAlt,
        },
        thinkBadgeText: {
            color: theme.text,
            fontSize: 12,
            fontWeight: '600',
        },
    });
