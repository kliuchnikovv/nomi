import React, { useMemo, useState } from 'react';
import { Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { NavArrowLeft, Xmark } from 'iconoir-react-native';
import { useTheme } from '../../../context/ThemeContext';
import { themes } from '../../../themes';
import { ConnectedTab } from '../connectors/tabs/ConnectedTab';
import { BrowserTab } from '../connectors/tabs/BrowserTab';
import { SettingsStackParamList } from '../../../navigation/types';

type Nav = NativeStackNavigationProp<SettingsStackParamList, 'IntegrationsScreen'>;

export function IntegrationsScreen() {
    const navigation = useNavigation<Nav>();
    const { theme, themeName } = useTheme();
    const palette = themes[themeName].palette;
    const insets = useSafeAreaInsets();
    const [browserOpen, setBrowserOpen] = useState(false);

    const styles = useMemo(() => StyleSheet.create({
        root: { flex: 1, backgroundColor: theme.background },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingBottom: 12,
            gap: 12,
        },
        backBtn: { padding: 4 },
        title: { flex: 1, fontSize: 24, fontWeight: '700', color: theme.textPrimary },
        addBtn: {
            paddingHorizontal: 14,
            paddingVertical: 7,
            borderRadius: 8,
            backgroundColor: theme.accent,
        },
        addBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
        body: { flex: 1, paddingHorizontal: 16 },
        // Modal
        modalOverlay: {
            flex: 1,
            justifyContent: 'flex-end',
        },
        modalBackdrop: {
            ...StyleSheet.absoluteFillObject,
            backgroundColor: 'rgba(0,0,0,0.5)',
        },
        modalSheet: {
            backgroundColor: theme.background,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            height: '85%',
        },
        modalHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 12,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.border,
        },
        modalTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: theme.textPrimary },
        closeBtn: { padding: 4 },
        modalBody: { flex: 1, paddingHorizontal: 16, paddingBottom: insets.bottom },
    }), [theme, palette, insets.bottom]);

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <NavArrowLeft width={24} height={24} color={theme.textPrimary} />
                </Pressable>
                <Text style={styles.title}>Integrations</Text>
                <Pressable onPress={() => setBrowserOpen(true)} style={styles.addBtn}>
                    <Text style={styles.addBtnText}>Add</Text>
                </Pressable>
            </View>

            <View style={styles.body}>
                <ConnectedTab />
            </View>

            <Modal
                visible={browserOpen}
                animationType="slide"
                transparent
                onRequestClose={() => setBrowserOpen(false)}
            >
                <View style={styles.modalOverlay}>
                    <Pressable style={styles.modalBackdrop} onPress={() => setBrowserOpen(false)} />
                    <View style={styles.modalSheet}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Add Integration</Text>
                            <Pressable onPress={() => setBrowserOpen(false)} style={styles.closeBtn}>
                                <Xmark width={22} height={22} color={theme.fadedText} />
                            </Pressable>
                        </View>
                        <View style={styles.modalBody}>
                            <BrowserTab onSuccess={() => setBrowserOpen(false)} />
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}
