import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator, Alert, Pressable, ScrollView,
    StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { NavArrowLeft } from 'iconoir-react-native';
import { useTheme } from '../../../context/ThemeContext';
import { themes } from '../../../themes';
import { BotIdentity, botIdentityApi } from '../../../apiClient';
import { SettingsStackParamList } from '../../../navigation/types';

type Nav = NativeStackNavigationProp<SettingsStackParamList, 'BotIdentityScreen'>;

export function BotIdentityScreen() {
    const navigation = useNavigation<Nav>();
    const { theme, themeName } = useTheme();
    const palette = themes[themeName].palette;
    const insets = useSafeAreaInsets();

    const [name, setName] = useState('Souper');
    const [instructions, setInstructions] = useState('');
    const [tone, setTone] = useState<BotIdentity['tone']>('casual');
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);

    const originalRef = useRef({ name: 'Souper', instructions: '', tone: 'casual' as BotIdentity['tone'] });

    useEffect(() => {
        botIdentityApi.get().then(identity => {
            if (identity) {
                const n = identity.name || 'Souper';
                const i = identity.instructions || '';
                const t = identity.tone || 'casual';
                setName(n); setInstructions(i); setTone(t);
                originalRef.current = { name: n, instructions: i, tone: t };
            }
        }).catch(() => {}).finally(() => setLoading(false));
    }, []);

    const isDirty = name !== originalRef.current.name
        || instructions !== originalRef.current.instructions
        || tone !== originalRef.current.tone;

    const handleBack = () => {
        if (isDirty) {
            Alert.alert('Unsaved Changes', 'Discard changes?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() },
            ]);
        } else {
            navigation.goBack();
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await botIdentityApi.update({ name: name || 'Souper', instructions, tone });
            originalRef.current = { name, instructions, tone };
            navigation.goBack();
        } catch {
            Alert.alert('Error', 'Failed to save bot identity.');
        } finally {
            setSaving(false);
        }
    };

    const styles = useMemo(() => StyleSheet.create({
        root: { flex: 1, backgroundColor: theme.background },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingBottom: 12,
            gap: 8,
        },
        backBtn: { padding: 4 },
        title: { flex: 1, fontSize: 24, fontWeight: '700', color: theme.textPrimary },
        saveBtn: {
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 8,
            backgroundColor: theme.accent,
        },
        saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
        body: { paddingHorizontal: 16, paddingTop: 8 },
        fieldLabel: { fontSize: 14, color: theme.fadedText, marginBottom: 6, marginTop: 16 },
        input: {
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            color: theme.textPrimary,
            backgroundColor: theme.surface,
            fontSize: 15,
        },
        multilineInput: {
            minHeight: 100,
            textAlignVertical: 'top',
        },
        toneRow: { flexDirection: 'row', gap: 8, marginTop: 0 },
        toneBtn: {
            flex: 1,
            paddingVertical: 10,
            borderRadius: 10,
            borderWidth: 1,
            alignItems: 'center',
        },
        toneBtnActive: { borderColor: theme.accent, backgroundColor: theme.surfaceHighlight },
        toneBtnInactive: { borderColor: theme.border, backgroundColor: 'transparent' },
        toneBtnTextActive: { color: theme.textPrimary, fontSize: 14, textTransform: 'capitalize', fontWeight: '600' },
        toneBtnTextInactive: { color: theme.fadedText, fontSize: 14, textTransform: 'capitalize' },
    }), [theme, palette]);

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Pressable onPress={handleBack} style={styles.backBtn}>
                    <NavArrowLeft width={24} height={24} color={theme.textPrimary} />
                </Pressable>
                <Text style={styles.title}>Bot Identity</Text>
                <Pressable onPress={handleSave} disabled={saving} style={styles.saveBtn}>
                    {saving
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Text style={styles.saveBtnText}>Save</Text>
                    }
                </Pressable>
            </View>
            {loading ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <ActivityIndicator size="large" color={theme.accent} />
                </View>
            ) : (
                <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
                    <Text style={styles.fieldLabel}>Name</Text>
                    <TextInput
                        value={name}
                        onChangeText={setName}
                        placeholder="Souper"
                        placeholderTextColor={theme.fadedText}
                        style={styles.input}
                    />
                    <Text style={styles.fieldLabel}>Instructions</Text>
                    <TextInput
                        value={instructions}
                        onChangeText={setInstructions}
                        placeholder="Describe how the bot should behave..."
                        placeholderTextColor={theme.fadedText}
                        multiline
                        style={[styles.input, styles.multilineInput]}
                    />
                    <Text style={styles.fieldLabel}>Tone</Text>
                    <View style={styles.toneRow}>
                        {(['formal', 'casual', 'playful'] as const).map(t => (
                            <Pressable
                                key={t}
                                onPress={() => setTone(t)}
                                style={[styles.toneBtn, tone === t ? styles.toneBtnActive : styles.toneBtnInactive]}
                            >
                                <Text style={tone === t ? styles.toneBtnTextActive : styles.toneBtnTextInactive}>
                                    {t}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                </ScrollView>
            )}
        </View>
    );
}
