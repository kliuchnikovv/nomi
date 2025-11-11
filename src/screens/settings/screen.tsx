import React, { useMemo } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/context.tsx';
import { styles } from './styles.tsx';

type Props = {
    visible: boolean;
    onClose: () => void;
};

export default function SettingsModal({ visible, onClose }: Props) {
    const { logout, user } = useAuth();
    const insets = useSafeAreaInsets();
    const paddingStyle = useMemo(
        () => ({ paddingTop: insets.top, paddingBottom: insets.bottom }),
        [insets.top, insets.bottom],
    );

    return (
        <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
            <View style={[styles.root, paddingStyle]}>
                <View style={styles.header}>
                    <Text style={styles.title}>Settings</Text>
                    <Pressable onPress={onClose} style={styles.closeBtn}>
                        <Text style={styles.closeText}>Close</Text>
                    </Pressable>
                </View>
                <View style={styles.body}>
                    {user && (
                        <View style={[styles.row, { marginBottom: 16 }]}>
                            <Text style={styles.label}>User</Text>
                            <Text style={styles.value}>{user?.email || user?.name || '—'}</Text>
                        </View>
                    )}

                    <View style={{ height: 24 }} />
                    <Pressable
                        onPress={async () => {
                            try { await logout(); } catch {}
                            onClose();
                        }}
                        style={styles.logoutBtn}
                    >
                        <Text style={styles.logoutText}>Выйти</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}
