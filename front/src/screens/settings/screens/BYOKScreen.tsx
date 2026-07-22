import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { NavArrowLeft, Check } from 'iconoir-react-native';
import { useTheme } from '../../../context/ThemeContext';
import { themes } from '../../../themes';
import { byokApi, BYOKProvider, BYOKProviderInfo } from '../../../apiClient';
import { SettingsStackParamList } from '../../../navigation/types';

type Nav = NativeStackNavigationProp<SettingsStackParamList, 'BYOKScreen'>;

const PROVIDERS: { id: BYOKProvider; label: string; placeholder: string }[] = [
    { id: 'anthropic', label: 'Anthropic (Claude)', placeholder: 'sk-ant-...' },
    { id: 'google', label: 'Google (Gemini)', placeholder: 'AIza...' },
    { id: 'openrouter', label: 'OpenRouter', placeholder: 'sk-or-...' },
];

export function BYOKScreen() {
    const navigation = useNavigation<Nav>();
    const { theme, themeName } = useTheme();
    const palette = themes[themeName].palette;
    const insets = useSafeAreaInsets();

    const [loading, setLoading] = useState(true);
    const [configured, setConfigured] = useState<BYOKProviderInfo[]>([]);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<BYOKProvider | null>(null);

    const refresh = () =>
        byokApi
            .list()
            .then(res => setConfigured(res?.providers || []))
            .catch(() => {})
            .finally(() => setLoading(false));

    useEffect(() => {
        refresh();
    }, []);

    const infoFor = (id: BYOKProvider) =>
        configured.find(p => p.provider === id);
    const defaultProvider = configured.find(p => p.is_default)?.provider;

    const handleSave = async (id: BYOKProvider) => {
        const key = (drafts[id] || '').trim();
        if (!key) return;
        setBusy(id);
        try {
            // First configured provider becomes default automatically.
            const makeDefault = configured.length === 0;
            await byokApi.save(id, key, makeDefault);
            setDrafts(d => ({ ...d, [id]: '' }));
            await refresh();
        } catch {
            Alert.alert('Error', `Failed to save ${id} key.`);
        } finally {
            setBusy(null);
        }
    };

    const handleDelete = async (id: BYOKProvider) => {
        setBusy(id);
        try {
            await byokApi.delete(id);
            await refresh();
        } catch {
            Alert.alert('Error', `Failed to remove ${id} key.`);
        } finally {
            setBusy(null);
        }
    };

    const handleSetDefault = async (id: BYOKProvider) => {
        setBusy(id);
        try {
            await byokApi.setDefault(id);
            await refresh();
        } catch {
            Alert.alert('Error', `Failed to set ${id} as default.`);
        } finally {
            setBusy(null);
        }
    };

    const styles = useMemo(
        () =>
            StyleSheet.create({
                root: { flex: 1, backgroundColor: theme.background },
                header: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 16,
                    paddingBottom: 12,
                    gap: 8,
                },
                backBtn: { padding: 4 },
                title: {
                    flex: 1,
                    fontSize: 24,
                    fontWeight: '700',
                    color: theme.textPrimary,
                },
                body: { paddingHorizontal: 16, paddingTop: 8 },
                intro: {
                    fontSize: 14,
                    color: theme.fadedText,
                    marginBottom: 8,
                    lineHeight: 20,
                },
                card: {
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 12,
                    backgroundColor: theme.surface,
                    padding: 14,
                    marginTop: 14,
                },
                cardHeader: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                },
                cardTitle: {
                    flex: 1,
                    fontSize: 16,
                    fontWeight: '600',
                    color: theme.textPrimary,
                },
                statusSet: {
                    fontSize: 12,
                    color: theme.accent,
                    fontWeight: '600',
                },
                statusUnset: { fontSize: 12, color: theme.fadedText },
                input: {
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    color: theme.textPrimary,
                    backgroundColor: theme.background,
                    fontSize: 15,
                    marginTop: 10,
                },
                actionRow: {
                    flexDirection: 'row',
                    gap: 8,
                    marginTop: 10,
                    alignItems: 'center',
                },
                saveBtn: {
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 8,
                    backgroundColor: theme.accent,
                },
                saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
                linkBtn: { paddingHorizontal: 8, paddingVertical: 8 },
                linkText: { color: theme.fadedText, fontSize: 14 },
                defaultBadge: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 8,
                    backgroundColor: theme.surfaceHighlight,
                },
                defaultText: {
                    color: theme.textPrimary,
                    fontSize: 12,
                    fontWeight: '600',
                },
            }),
        [theme, palette],
    );

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Pressable
                    onPress={() => navigation.goBack()}
                    style={styles.backBtn}
                >
                    <NavArrowLeft
                        width={24}
                        height={24}
                        color={theme.textPrimary}
                    />
                </Pressable>
                <Text style={styles.title}>AI Keys (BYOK)</Text>
            </View>
            {loading ? (
                <View
                    style={{
                        flex: 1,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <ActivityIndicator size="large" color={theme.accent} />
                </View>
            ) : (
                <ScrollView
                    style={styles.body}
                    contentContainerStyle={{
                        paddingBottom: insets.bottom + 32,
                    }}
                >
                    <Text style={styles.intro}>
                        Bring your own LLM provider key. The developer agent
                        uses it to run the opencode coding agent in your
                        sandbox. Keys are stored encrypted and never shown
                        again.
                    </Text>
                    {PROVIDERS.map(p => {
                        const info = infoFor(p.id);
                        const isSet = !!info;
                        const isDefault = defaultProvider === p.id;
                        return (
                            <View key={p.id} style={styles.card}>
                                <View style={styles.cardHeader}>
                                    <Text style={styles.cardTitle}>
                                        {p.label}
                                    </Text>
                                    {isDefault && (
                                        <View style={styles.defaultBadge}>
                                            <Check
                                                width={12}
                                                height={12}
                                                color={theme.textPrimary}
                                            />
                                            <Text style={styles.defaultText}>
                                                Default
                                            </Text>
                                        </View>
                                    )}
                                    <Text
                                        style={
                                            isSet
                                                ? styles.statusSet
                                                : styles.statusUnset
                                        }
                                    >
                                        {isSet ? 'Configured' : 'Not set'}
                                    </Text>
                                </View>
                                <TextInput
                                    value={drafts[p.id] || ''}
                                    onChangeText={t =>
                                        setDrafts(d => ({ ...d, [p.id]: t }))
                                    }
                                    placeholder={
                                        isSet
                                            ? 'Enter a new key to replace'
                                            : p.placeholder
                                    }
                                    placeholderTextColor={theme.fadedText}
                                    secureTextEntry
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    style={styles.input}
                                />
                                <View style={styles.actionRow}>
                                    <Pressable
                                        onPress={() => handleSave(p.id)}
                                        disabled={
                                            busy === p.id ||
                                            !(drafts[p.id] || '').trim()
                                        }
                                        style={[
                                            styles.saveBtn,
                                            {
                                                opacity: (
                                                    drafts[p.id] || ''
                                                ).trim()
                                                    ? 1
                                                    : 0.5,
                                            },
                                        ]}
                                    >
                                        {busy === p.id ? (
                                            <ActivityIndicator
                                                size="small"
                                                color="#fff"
                                            />
                                        ) : (
                                            <Text style={styles.saveBtnText}>
                                                Save
                                            </Text>
                                        )}
                                    </Pressable>
                                    {isSet && !isDefault && (
                                        <Pressable
                                            onPress={() =>
                                                handleSetDefault(p.id)
                                            }
                                            style={styles.linkBtn}
                                        >
                                            <Text style={styles.linkText}>
                                                Set default
                                            </Text>
                                        </Pressable>
                                    )}
                                    {isSet && (
                                        <Pressable
                                            onPress={() => handleDelete(p.id)}
                                            style={styles.linkBtn}
                                        >
                                            <Text
                                                style={[
                                                    styles.linkText,
                                                    {
                                                        color:
                                                            theme.error ||
                                                            '#d33',
                                                    },
                                                ]}
                                            >
                                                Remove
                                            </Text>
                                        </Pressable>
                                    )}
                                </View>
                            </View>
                        );
                    })}
                </ScrollView>
            )}
        </View>
    );
}
