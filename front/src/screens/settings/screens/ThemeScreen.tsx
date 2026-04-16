import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Check, NavArrowLeft } from 'iconoir-react-native';
import { useTheme } from '../../../context/ThemeContext';
import { ThemeName, themes } from '../../../themes';
import { SettingsStackParamList } from '../../../navigation/types';

type Nav = NativeStackNavigationProp<SettingsStackParamList, 'ThemeScreen'>;

export function ThemeScreen() {
    const navigation = useNavigation<Nav>();
    const { theme, themeName, setTheme } = useTheme();
    const palette = themes[themeName].palette;
    const insets = useSafeAreaInsets();

    const themesList: { label: string; value: ThemeName }[] = useMemo(
        () => Object.entries(themes).map(([key, d]) => ({ label: d.name, value: key as ThemeName })),
        [],
    );

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
        swatch: {
            width: 20,
            height: 20,
            borderRadius: 10,
            marginRight: 12,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
        },
        optionLabel: { flex: 1, fontSize: 16, fontWeight: '500', color: theme.textPrimary },
    }), [theme, palette]);

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <NavArrowLeft width={24} height={24} color={theme.textPrimary} />
                </Pressable>
                <Text style={styles.title}>Theme</Text>
            </View>
            <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
                {themesList.map((t) => (
                    <Pressable
                        key={t.value}
                        onPress={() => {
                            setTheme(t.value);
                        }}
                        style={[styles.option, themeName === t.value ? styles.optionSelected : styles.optionUnselected]}
                    >
                        <View style={[styles.swatch, { backgroundColor: themes[t.value].colors.accent }]} />
                        <Text style={styles.optionLabel}>{t.label}</Text>
                        {themeName === t.value && (
                            <Check width={18} height={18} color={theme.accent} />
                        )}
                    </Pressable>
                ))}
            </ScrollView>
        </View>
    );
}
