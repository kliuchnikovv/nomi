import React from 'react';
import {
    Modal,
    Pressable,
    TouchableOpacity,
    View,
    Text,
    StyleSheet,
} from 'react-native';
import { Clock, MapPin } from 'iconoir-react-native';
import { useTheme } from '../../../context/ThemeContext';

interface Props {
    visible: boolean;
    onClose: () => void;
    onSelectTime: () => void;
    onSelectLocation: () => void;
}

export function AddChipMenu({ visible, onClose, onSelectTime, onSelectLocation }: Props) {
    const { theme } = useTheme();

    const menuBg = (theme as any).surface ?? theme.background;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <Pressable style={styles.backdrop} onPress={onClose}>
                <Pressable
                    style={[styles.menu, { backgroundColor: menuBg, borderColor: theme.border }]}
                >
                    <TouchableOpacity
                        style={styles.menuItem}
                        onPress={() => { onClose(); onSelectTime(); }}
                        activeOpacity={0.7}
                    >
                        <Clock width={16} height={16} color="#007AFF" />
                        <Text style={[styles.menuItemText, { color: theme.textPrimary }]}>
                            Time
                        </Text>
                    </TouchableOpacity>

                    <View style={[styles.divider, { backgroundColor: theme.border }]} />

                    <TouchableOpacity
                        style={styles.menuItem}
                        onPress={() => { onClose(); onSelectLocation(); }}
                        activeOpacity={0.7}
                    >
                        <MapPin width={16} height={16} color="#FF6B00" />
                        <Text style={[styles.menuItemText, { color: theme.textPrimary }]}>
                            Location
                        </Text>
                    </TouchableOpacity>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.25)',
    },
    menu: {
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        paddingVertical: 4,
        minWidth: 160,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 6,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        marginHorizontal: 12,
    },
    menuItemText: {
        fontSize: 15,
        fontWeight: '500',
    },
});
