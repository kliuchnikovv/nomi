import React, { useMemo } from 'react';
import {
    Modal,
    Pressable,
    StyleSheet,
    Text,
    View,
    Switch,
    ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../themes/types';

export type ContextMenuItem = {
    id: string;
    label: string;
    icon?: React.ReactNode;
    onPress: () => void;
    destructive?: boolean;
    isSwitch?: boolean;
    switchValue?: boolean;
};

export type ContextMenuSection = {
    title: string;
    items: ContextMenuItem[];
};

type Props = {
    visible: boolean;
    onClose: () => void;
    /** Flat list of items (used when sections is not provided) */
    items?: ContextMenuItem[];
    /** Grouped items by section (when provided, items is ignored) */
    sections?: ContextMenuSection[];
    title?: string;
    position?: 'bottom-left' | 'center';
    anchorOffset?: { x: number; y: number };
};

export const ContextMenu = ({
    visible,
    onClose,
    items = [],
    sections,
    title,
    position = 'bottom-left',
}: Props) => {
    const insets = useSafeAreaInsets();
    const { theme } = useTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);

    const renderItem = (item: ContextMenuItem, showBorder: boolean) => (
        <Pressable
            key={item.id}
            onPress={() => {
                item.onPress();
                if (!item.isSwitch) {
                    onClose();
                }
            }}
            style={({ pressed }) => [
                styles.item,
                pressed && !item.isSwitch && styles.itemPressed,
                showBorder && styles.itemBorder,
            ]}
        >
            <Text
                style={[
                    styles.itemText,
                    item.destructive && styles.destructiveText,
                ]}
            >
                {item.label}
            </Text>
            <View style={styles.rightContainer}>
                {item.isSwitch ? (
                    <Switch
                        value={item.switchValue}
                        onValueChange={() => {
                            item.onPress();
                        }}
                        trackColor={{ false: theme.border, true: theme.accent }}
                        thumbColor="#fff"
                        ios_backgroundColor={theme.border}
                        style={{ transform: [{ scale: 0.8 }] }}
                    />
                ) : (
                    item.icon && <View style={styles.icon}>{item.icon}</View>
                )}
            </View>
        </Pressable>
    );

    const content = sections ? (
        sections.map((section, sectionIndex) => (
            <View key={section.title + sectionIndex}>
                <Text style={styles.sectionHeader}>{section.title}</Text>
                {section.items.map((item, index) => {
                    const isLastInSection = index === section.items.length - 1;
                    const isLastSection = sectionIndex === sections.length - 1;
                    const showBorder = !isLastInSection || !isLastSection;
                    return renderItem(item, showBorder);
                })}
            </View>
        ))
    ) : (
        items.map((item, index) => renderItem(item, index < items.length - 1))
    );

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <Pressable style={styles.overlay} onPress={onClose}>
                <View
                    style={[
                        styles.menuContainer,
                        position === 'bottom-left' && {
                            position: 'absolute',
                            left: 16,
                            bottom: insets.bottom + 80,
                        },
                        position === 'center' && {
                            alignSelf: 'center',
                            marginTop: 'auto',
                            marginBottom: 'auto',
                        },
                    ]}
                >
                    {title && <Text style={styles.title}>{title}</Text>}
                    <ScrollView style={{ maxHeight: 320 }} bounces={false} showsVerticalScrollIndicator={true}>
                        {content}
                    </ScrollView>
                </View>
            </Pressable>
        </Modal>
    );
};

const createStyles = (theme: ThemeColors) => StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
    },
    menuContainer: {
        backgroundColor: theme.surfaceAlt,
        borderRadius: 14,
        paddingVertical: 0,
        width: 250,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: `${theme.border}40`,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
    },
    title: {
        fontSize: 13,
        color: theme.textSecondary,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 4,
        fontWeight: '600',
    },
    sectionHeader: {
        fontSize: 12,
        color: theme.textSecondary,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 4,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
        paddingHorizontal: 16,
        backgroundColor: theme.surfaceAlt,
    },
    itemBorder: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: `${theme.border}40`,
    },
    itemPressed: {
        backgroundColor: theme.surfaceHighlight,
    },
    itemText: {
        fontSize: 17,
        color: theme.text,
        fontWeight: '400',
    },
    destructiveText: {
        color: theme.attention,
    },
    rightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    icon: {
        marginLeft: 8,
    },
});
