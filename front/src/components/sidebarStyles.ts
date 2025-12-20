import { StyleSheet } from 'react-native';
import { ThemeColors } from '../themes/types';

export type SidebarSide = 'left' | 'right';

export const createSidebarStyles = (theme: ThemeColors, side: SidebarSide) => {
    const isLeft = side === 'left';

    return StyleSheet.create({
        container: {
            height: '100%',
            backgroundColor: theme.surface,
            borderRightWidth: isLeft ? StyleSheet.hairlineWidth : 0,
            borderRightColor: isLeft ? theme.border : 'transparent',
            borderLeftWidth: isLeft ? 0 : StyleSheet.hairlineWidth,
            borderLeftColor: isLeft ? 'transparent' : theme.border,
            borderTopRightRadius: isLeft ? 24 : 0,
            borderBottomRightRadius: isLeft ? 24 : 0,
            borderTopLeftRadius: isLeft ? 0 : 24,
            borderBottomLeftRadius: isLeft ? 0 : 24,
            paddingTop: 12,
            paddingBottom: 12,
            paddingHorizontal: 12,
        },
        overlayRoot: {
            ...StyleSheet.absoluteFillObject,
            justifyContent: 'flex-start',
        },
        overlayBackdrop: {
            ...StyleSheet.absoluteFillObject,
            backgroundColor: 'rgba(12, 12, 16, 0.75)',
        },
        overlayCard: {
            height: '100%',
            backgroundColor: theme.surface,
            borderRightWidth: isLeft ? StyleSheet.hairlineWidth : 0,
            borderRightColor: isLeft ? theme.border : 'transparent',
            borderLeftWidth: isLeft ? 0 : StyleSheet.hairlineWidth,
            borderLeftColor: isLeft ? 'transparent' : theme.border,
            borderTopRightRadius: isLeft ? 24 : 0,
            borderBottomRightRadius: isLeft ? 24 : 0,
            borderTopLeftRadius: isLeft ? 0 : 24,
            borderBottomLeftRadius: isLeft ? 0 : 24,
            paddingBottom: 16,
            paddingHorizontal: 12,
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 12,
            elevation: 8,
            // Position based on side
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: isLeft ? 0 : undefined,
            right: isLeft ? undefined : 0,
        },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
        },
        title: {
            color: theme.textPrimary,
            fontSize: 16,
            fontWeight: '700',
        },
        actionButton: {
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 8,
            backgroundColor: theme.accent,
        },
        actionButtonText: {
            color: theme.background,
            fontWeight: '700',
            fontSize: 13,
        },
        list: {
            marginHorizontal: -4,
        },
        listContent: {
            paddingBottom: 12,
        },
        item: {
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 12,
        },
        itemActive: {
            backgroundColor: theme.surfaceHighlight,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
        },
        itemHighlighted: {
            backgroundColor: `${theme.accent}15`,
        },
        itemTitle: {
            color: theme.textPrimary,
            fontWeight: '600',
            fontSize: 14,
        },
        itemSubtitle: {
            color: theme.textSecondary,
            fontSize: 12,
            marginTop: 4,
        },
        footer: {
            marginTop: 'auto',
            paddingTop: 12,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.border,
        },
        footerButton: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 12,
            paddingHorizontal: 12,
            borderRadius: 12,
            backgroundColor: 'transparent',
        },
        footerButtonPressed: {
            backgroundColor: theme.surfaceHighlight,
        },
        footerButtonText: {
            color: theme.textPrimary,
            fontSize: 14,
            fontWeight: '600',
            marginLeft: 12,
        },
    });
};

export type SidebarStyles = ReturnType<typeof createSidebarStyles>;
