import React from 'react';
import { View, StyleSheet, ScrollView, Text } from 'react-native';
import { ContextItemCard } from './ContextItemCard';
import { ThemeColors } from '../../../themes/types';

interface MessageContextItemsProps {
    contextItems?: any[];
    theme: ThemeColors;
}

export const MessageContextItems: React.FC<MessageContextItemsProps> = ({
    contextItems,
    theme,
}) => {
    if (!contextItems || contextItems.length === 0) {
        return null;
    }

    return (
        <View style={styles.container}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
            >
                {contextItems.map((item: any) => (
                    <View key={item.id} style={styles.itemWrapper}>
                        <ContextItemCard item={item} removable={false} />
                    </View>
                ))}
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        marginBottom: 8,
    },
    label: {
        fontSize: 12,
        fontWeight: '500',
        marginBottom: 6,
        paddingHorizontal: 2,
    },
    scrollContent: {
        gap: 8,
    },
    itemWrapper: {
        width: 200,
    },
});
