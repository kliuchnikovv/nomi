import {
    KeyboardAvoidingView,
    Platform,
    Pressable,
    Text,
    View,
} from 'react-native';
import { getStyles } from './styles.tsx';
import React, { useMemo, useState } from 'react';
import { Props } from './models.tsx';
import { useTheme } from '../../../context/ThemeContext';
import { ConnectedTab } from './tabs/ConnectedTab';
import { BrowserTab } from './tabs/BrowserTab';

export default function ConnectorScreenDialog({ onClose }: Props) {
    const { theme, palette } = useTheme();
    const styles = useMemo(() => getStyles(theme, palette), [theme, palette]);
    const [activeTab, setActiveTab] = useState<'connected' | 'browser'>('connected');

    return (
        <View style={styles.overlay} pointerEvents="box-none">
            <Pressable style={styles.backdrop} onPress={onClose} />
            <View style={styles.sheet}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <Text style={styles.dialogTitle}>Apps & connectors</Text>
                    {/* Tab Selector */}
                    <View style={{ flexDirection: 'row', backgroundColor: theme.surfaceHighlight, borderRadius: 8, padding: 2 }}>
                        <Pressable
                            onPress={() => setActiveTab('connected')}
                            style={{
                                paddingHorizontal: 12,
                                paddingVertical: 6,
                                borderRadius: 6,
                                backgroundColor: activeTab === 'connected' ? theme.surface : 'transparent',
                            }}
                        >
                            <Text style={{
                                color: activeTab === 'connected' ? theme.text : theme.fadedText,
                                fontWeight: '600',
                                fontSize: 13
                            }}>Connected</Text>
                        </Pressable>
                        <Pressable
                            onPress={() => setActiveTab('browser')}
                            style={{
                                paddingHorizontal: 12,
                                paddingVertical: 6,
                                borderRadius: 6,
                                backgroundColor: activeTab === 'browser' ? theme.surface : 'transparent',
                            }}
                        >
                            <Text style={{
                                color: activeTab === 'browser' ? theme.text : theme.fadedText,
                                fontWeight: '600',
                                fontSize: 13
                            }}>Browser</Text>
                        </Pressable>
                    </View>
                </View>

                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={{ flex: 1, maxHeight: 500 }}
                >
                    {activeTab === 'connected' ? <ConnectedTab /> : <BrowserTab />}
                </KeyboardAvoidingView>
            </View>
        </View>
    );
}
