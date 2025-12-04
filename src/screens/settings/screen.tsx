import React, { useMemo, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/context.tsx';
import { createStyles } from './styles.tsx';
import { ConnectorsProvider } from './connectors/context.tsx';
import ConnectorScreenDialog from './connectors/screen.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { ThemeName, themes } from '../../themes';

type Props = {
    visible: boolean;
    onClose: () => void;
};

export default function SettingsModal({ visible, onClose }: Props) {
    const { logout, user } = useAuth();
    const { themeName, setTheme, theme } = useTheme();
    const insets = useSafeAreaInsets();
    const paddingStyle = useMemo(
        () => ({ paddingTop: insets.top, paddingBottom: insets.bottom }),
        [insets.top, insets.bottom],
    );

    const [connectorsOpen, setConnectorsOpen] = useState(false);
    const [themeExpanded, setThemeExpanded] = useState(false);

    // Get current theme palette
    const palette = themes[themeName].palette;
    const styles = useMemo(() => createStyles(theme, palette), [theme, palette]);

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
        { label: 'Light (Visual Studio)', value: 'visualStudioLight' },
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

                        <View style={{ marginBottom: 16 }}>
                            <Pressable
                                onPress={() => setThemeExpanded(!themeExpanded)}
                                style={styles.themeHeader}
                            >
                                <View>
                                    <Text style={styles.label}>Theme</Text>
                                    <Text style={styles.themeCurrentValue}>
                                        {themesList.find(t => t.value === themeName)?.label}
                                    </Text>
                                </View>
                                <Text style={styles.chevron}>
                                    {themeExpanded ? '▼' : '▶'}
                                </Text>
                            </Pressable>
                            {themeExpanded && (
                                <View style={{ marginTop: 12 }}>
                                    {themesList.map((t) => (
                                        <Pressable
                                            key={t.value}
                                            onPress={() => {
                                                setTheme(t.value);
                                                setThemeExpanded(false);
                                            }}
                                            style={[
                                                styles.themeOption,
                                                themeName === t.value
                                                    ? styles.themeOptionSelected
                                                    : styles.themeOptionUnselected,
                                            ]}
                                        >
                                            <Text style={styles.themeOptionText}>
                                                {t.label}
                                            </Text>
                                            {themeName === t.value && (
                                                <Text style={styles.themeCheckmark}>✓</Text>
                                            )}
                                        </Pressable>
                                    ))}
                                </View>
                            )}
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
