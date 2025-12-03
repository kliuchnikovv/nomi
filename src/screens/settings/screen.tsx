import React, { useMemo, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/context.tsx';
import { styles } from './styles.tsx';
import ConnectorsDialog from './connectors/connectors.tsx';
import { emptyChatID } from '../main/context.tsx';
import ChatScreen from '../chat/screen.tsx';
import { ChatProvider } from '../chat/context.tsx';
import { ConnectorsProvider } from './connectors/context.tsx';
import ConnectorScreenDialog from './connectors/screen.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { ThemeName } from '../../themes';

type Props = {
    visible: boolean;
    onClose: () => void;
};

export default function SettingsModal({ visible, onClose }: Props) {
    const { logout, user } = useAuth();
    const { themeName, setTheme } = useTheme();
    const insets = useSafeAreaInsets();
    const paddingStyle = useMemo(
        () => ({ paddingTop: insets.top, paddingBottom: insets.bottom }),
        [insets.top, insets.bottom],
    );

    const [connectorsOpen, setConnectorsOpen] = useState(false);

    React.useEffect(() => {
        console.log('SettingsModal mounted');
        return () => console.log('SettingsModal unmounted');
    }, []);

    const handleClose = () => {
        console.log('SettingsModal onClose called');
        onClose();
    };

    const themesList: { label: string; value: ThemeName }[] = [
        { label: 'Tokyo Night', value: 'tokyoNight' },
        { label: 'One Dark', value: 'oneDark' },
    ];

    return (
        <>
            <Modal
                visible={visible}
                animationType="slide"
                transparent={false}
                onRequestClose={handleClose}
            >
                <View style={[styles.root, paddingStyle]}>
                    <View style={styles.header}>
                        <Text style={styles.title}>Settings</Text>
                        <Pressable onPress={handleClose} style={styles.closeBtn}>
                            <Text style={styles.closeText}>Close</Text>
                        </Pressable>
                    </View>
                    <View style={styles.body}>
                        {user && (
                            <View style={[styles.row, { marginBottom: 16 }]}>
                                <Text style={styles.label}>User</Text>
                                <Text style={styles.value}>
                                    {user?.email || user?.name || '—'}
                                </Text>
                            </View>
                        )}

                        <View style={[styles.row, { marginBottom: 16, flexDirection: 'column', alignItems: 'flex-start' }]}>
                            <Text style={[styles.label, { marginBottom: 8 }]}>Theme</Text>
                            <View style={{ flexDirection: 'row', gap: 8 }}>
                                {themesList.map((t) => (
                                    <Pressable
                                        key={t.value}
                                        onPress={() => setTheme(t.value)}
                                        style={[
                                            styles.connectorsBtn,
                                            { backgroundColor: themeName === t.value ? '#7aa2f7' : '#24283b', paddingHorizontal: 12, paddingVertical: 6, minWidth: 'auto' }
                                        ]}
                                    >
                                        <Text style={[styles.logoutText, { color: themeName === t.value ? '#1a1b26' : '#c0caf5' }]}>
                                            {t.label}
                                        </Text>
                                    </Pressable>
                                ))}
                            </View>
                        </View>

                        <View>
                            <Pressable
                                onPress={() => {
                                    console.log('onPress');
                                    setConnectorsOpen(true);
                                    console.log(
                                        `onPress finished - ${connectorsOpen}`,
                                    );
                                }}
                                style={({ pressed }) => [
                                    styles.connectorsBtn,
                                    pressed && { opacity: 0.8 },
                                ]}
                            >
                                <Text style={styles.logoutText}>
                                    Connectors
                                </Text>
                            </Pressable>
                        </View>

                        <View style={{ height: 24 }} />
                        <Pressable
                            onPress={async () => {
                                try {
                                    await logout();
                                } catch { }
                                onClose();
                            }}
                            style={({ pressed }) => [
                                styles.logoutBtn,
                                pressed && { opacity: 0.8 },
                            ]}
                        >
                            <Text style={styles.logoutText}>Logout</Text>
                        </Pressable>
                    </View>
                    {connectorsOpen && (
                        <ConnectorsProvider>
                            <ConnectorScreenDialog
                                visible={true}
                                onClose={() => setConnectorsOpen(false)}
                            />
                        </ConnectorsProvider>
                        // <ConnectorsDialog
                        //     visible={connectorsOpen}
                        //     onClose={() => setConnectorsOpen(false)}
                        // />
                    )}
                </View>
            </Modal>
        </>
    );
}
