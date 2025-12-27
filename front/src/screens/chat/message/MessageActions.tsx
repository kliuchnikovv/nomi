import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MessageAction } from '../../main/models';
import { ThemeColors } from '../../../themes/types';

interface MessageActionsProps {
    actions?: MessageAction[];
    theme: ThemeColors;
    onActionPress?: (action: MessageAction) => void;
}

export const MessageActions: React.FC<MessageActionsProps> = ({ actions, theme, onActionPress }) => {
    // Debug logging
    console.log('[MessageActions] Rendering with actions:', actions);

    if (!actions || actions.length === 0) {
        return null;
    }

    return (
        <View style={styles.container}>
            {actions.map((action, index) => (
                <TouchableOpacity
                    key={`${index}-${action.label}`}
                    style={[
                        styles.chip,
                        {
                            backgroundColor: theme.surface,
                            borderColor: theme.border,
                        }
                    ]}
                    onPress={() => onActionPress?.(action)}
                >
                    <Text style={[styles.label, { color: theme.textPrimary }]}>
                        {action.label}
                    </Text>
                </TouchableOpacity>
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: 8,
        gap: 8,
    },
    chip: {
        borderRadius: 16,
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderWidth: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    label: {
        fontSize: 13,
        fontWeight: '500',
    },
});
