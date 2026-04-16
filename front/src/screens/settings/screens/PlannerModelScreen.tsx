import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Check, NavArrowLeft } from 'iconoir-react-native';
import { useTheme } from '../../../context/ThemeContext';
import { themes } from '../../../themes';
import { modelsApi } from '../../../apiClient';
import { ModelDetail } from '../../../types/Model';
import { SettingsStackParamList } from '../../../navigation/types';
import { PLANNER_MODEL_KEY, PLANNER_PROVIDER_KEY } from '../screen';

type Nav = NativeStackNavigationProp<SettingsStackParamList, 'PlannerModelScreen'>;

export function PlannerModelScreen() {
    const navigation = useNavigation<Nav>();
    const { theme, themeName } = useTheme();
    const palette = themes[themeName].palette;
    const insets = useSafeAreaInsets();

    const [models, setModels] = useState<ModelDetail[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState('');

    useEffect(() => {
        Promise.all([
            modelsApi.getModels().catch(() => [] as ModelDetail[]),
            AsyncStorage.getItem(PLANNER_MODEL_KEY),
        ]).then(([allModels, savedId]) => {
            setModels(allModels.filter(m => m.supports_tools));
            if (savedId) setSelectedId(savedId);
        }).finally(() => setLoading(false));
    }, []);

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
        title: { fontSize: 24, fontWeight: '700', color: theme.textPrimary },
        body: { paddingHorizontal: 16, paddingTop: 8 },
        option: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 14,
            paddingHorizontal: 16,
            borderRadius: 12,
            marginBottom: 8,
            borderWidth: 2,
        },
        optionSelected: {
            backgroundColor: theme.surfaceHighlight,
            borderColor: theme.accent,
        },
        optionUnselected: {
            backgroundColor: theme.surface,
            borderColor: 'transparent',
        },
        optionName: { fontSize: 16, fontWeight: '500', color: theme.textPrimary },
        optionProvider: { fontSize: 12, color: theme.fadedText, marginTop: 2 },
        centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    }), [theme, palette]);

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <NavArrowLeft width={24} height={24} color={theme.textPrimary} />
                </Pressable>
                <Text style={styles.title}>Planner Model</Text>
            </View>
            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color={theme.accent} />
                </View>
            ) : (
                <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
                    {models.map(m => (
                        <Pressable
                            key={m.id}
                            onPress={async () => {
                                setSelectedId(m.id);
                                await AsyncStorage.setItem(PLANNER_MODEL_KEY, m.id);
                                await AsyncStorage.setItem(PLANNER_PROVIDER_KEY, m.provider ?? '');
                                navigation.goBack();
                            }}
                            style={[styles.option, selectedId === m.id ? styles.optionSelected : styles.optionUnselected]}
                        >
                            <View style={{ flex: 1 }}>
                                <Text style={styles.optionName}>{m.name}</Text>
                                <Text style={styles.optionProvider}>{m.provider}</Text>
                            </View>
                            {selectedId === m.id && (
                                <Check width={18} height={18} color={theme.accent} />
                            )}
                        </Pressable>
                    ))}
                </ScrollView>
            )}
        </View>
    );
}
