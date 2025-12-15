import React, { useMemo } from 'react';
import {
    Modal,
    Pressable,
    StyleSheet,
    Text,
    View,
    Switch,
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

type Props = {
    visible: boolean;
    onClose: () => void;
    items: ContextMenuItem[];
    title?: string;
    position?: 'bottom-left' | 'center';
    anchorOffset?: { x: number; y: number };
};

export const ContextMenu = ({
    visible,
    onClose,
    items,
    title,
    position = 'bottom-left',
}: Props) => {
    const insets = useSafeAreaInsets();
    const { theme } = useTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);

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
                    {items.map((item, index) => (
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
                                index < items.length - 1 && styles.itemBorder,
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
                                            // Do not close menu
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
                    ))}
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
