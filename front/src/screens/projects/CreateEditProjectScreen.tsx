import React, { useCallback, useEffect, useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { projectsApi } from '../../apiClient';
import type { ProjectsStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'CreateEditProject'>;
type Route = RouteProp<ProjectsStackParamList, 'CreateEditProject'>;

const EMOJI_OPTIONS = ['📁', '💼', '🔬', '🎮', '📚', '🏠', '✈️', '🎨', '🧩', '⚙️', '🌿', '💡'];

export function CreateEditProjectScreen() {
    const navigation = useNavigation<Nav>();
    const route = useRoute<Route>();
    const { projectId } = route.params ?? {};
    const isEdit = !!projectId;
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [icon, setIcon] = useState('📁');
    const [saving, setSaving] = useState(false);
    const [loadingExisting, setLoadingExisting] = useState(isEdit);

    const loadExisting = useCallback(async () => {
        if (!projectId) return;
        try {
            const projects = await projectsApi.list();
            const existing = (projects ?? []).find((p) => p.id === projectId);
            if (existing) {
                setName(existing.name);
                setDescription(existing.description);
                setIcon(existing.icon);
            }
        } finally {
            setLoadingExisting(false);
        }
    }, [projectId]);

    useEffect(() => {
        loadExisting();
    }, [loadExisting]);

    const handleSave = async () => {
        if (!name.trim()) return;
        setSaving(true);
        try {
            if (isEdit && projectId) {
                await projectsApi.update(projectId, { name: name.trim(), description: description.trim(), icon });
            } else {
                await projectsApi.create({ name: name.trim(), description: description.trim(), icon });
            }
            navigation.goBack();
        } finally {
            setSaving(false);
        }
    };

    if (loadingExisting) {
        return (
            <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top }]}>
                <ActivityIndicator style={styles.loader} color={theme.accent} />
            </View>
        );
    }

    return (
        <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top }]}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>
                        {isEdit ? 'Edit project' : 'New project'}
                    </Text>
                    <TouchableOpacity onPress={handleSave} disabled={saving || !name.trim()}>
                        {saving ? (
                            <ActivityIndicator size="small" color={theme.accent} />
                        ) : (
                            <Text style={[styles.saveBtn, { color: name.trim() ? theme.accent : theme.textSecondary }]}>
                                Save
                            </Text>
                        )}
                    </TouchableOpacity>
                </View>

                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                    <Text style={[styles.label, { color: theme.textSecondary }]}>ICON</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.emojiRow}>
                        {EMOJI_OPTIONS.map((emoji) => (
                            <TouchableOpacity
                                key={emoji}
                                style={[
                                    styles.emojiBtn,
                                    { backgroundColor: theme.surface },
                                    icon === emoji && { borderColor: theme.accent, borderWidth: 2 },
                                ]}
                                onPress={() => setIcon(emoji)}
                            >
                                <Text style={styles.emoji}>{emoji}</Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>

                    <Text style={[styles.label, { color: theme.textSecondary }]}>NAME</Text>
                    <TextInput
                        style={[styles.input, { backgroundColor: theme.surface, color: theme.textPrimary, borderColor: theme.border }]}
                        value={name}
                        onChangeText={setName}
                        placeholder="Project name"
                        placeholderTextColor={theme.textSecondary}
                        maxLength={80}
                        returnKeyType="next"
                    />

                    <Text style={[styles.label, { color: theme.textSecondary }]}>DESCRIPTION</Text>
                    <TextInput
                        style={[styles.input, styles.multiline, { backgroundColor: theme.surface, color: theme.textPrimary, borderColor: theme.border }]}
                        value={description}
                        onChangeText={setDescription}
                        placeholder="Optional description"
                        placeholderTextColor={theme.textSecondary}
                        multiline
                        numberOfLines={4}
                        maxLength={500}
                    />
                </ScrollView>
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    loader: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
    },
    headerTitle: { flex: 1, fontSize: 18, fontWeight: '600' },
    saveBtn: { fontSize: 16, fontWeight: '600' },
    content: { padding: 16, gap: 8 },
    label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5, marginTop: 12, marginBottom: 4 },
    emojiRow: { marginBottom: 8 },
    emojiBtn: {
        width: 48,
        height: 48,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
    },
    emoji: { fontSize: 24 },
    input: {
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        padding: 12,
        fontSize: 15,
    },
    multiline: { height: 100, textAlignVertical: 'top' },
});
