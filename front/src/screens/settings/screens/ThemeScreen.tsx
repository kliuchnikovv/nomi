import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Check, NavArrowLeft } from 'iconoir-react-native';
import { Text } from '@genie/ds';
import { useTheme } from '../../../context/ThemeContext';
import { ThemeName, themes } from '../../../themes';
import { SettingsStackParamList } from '../../../navigation/types';

type Nav = NativeStackNavigationProp<SettingsStackParamList, 'ThemeScreen'>;

export function ThemeScreen() {
    const navigation = useNavigation<Nav>();
    const { theme, themeName, setTheme, descriptor } = useTheme();
    const insets = useSafeAreaInsets();

    const { darkThemes, lightThemes } = useMemo(() => {
        const all = Object.entries(themes).map(([key, d]) => ({
            label: d.name,
            value: key as ThemeName,
        }));
        return {
            darkThemes: all.filter(t => themes[t.value].variant === 'dark'),
            lightThemes: all.filter(t => themes[t.value].variant === 'light'),
        };
    }, []);

    const styles = useMemo(
        () =>
            StyleSheet.create({
                root: { flex: 1, backgroundColor: theme.background },
                header: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: descriptor.spacing.lg,
                    paddingBottom: descriptor.spacing.md,
                    gap: descriptor.spacing.sm,
                },
                backBtn: { padding: descriptor.spacing.xs },
                body: {
                    paddingHorizontal: descriptor.spacing.lg,
                    paddingTop: descriptor.spacing.sm,
                },
                option: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: descriptor.spacing.md,
                    paddingHorizontal: descriptor.spacing.lg,
                    borderRadius: descriptor.radius.md,
                    marginBottom: descriptor.spacing.sm,
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
                    marginRight: descriptor.spacing.md,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.border,
                },
                optionLabelBox: { flex: 1 },
                sectionHeaderBox: {
                    marginTop: descriptor.spacing.lg,
                    marginBottom: descriptor.spacing.sm,
                    paddingHorizontal: descriptor.spacing.xs,
                },
                sectionHeaderSpacer: { marginTop: descriptor.spacing.xl },
            }),
        [theme, descriptor],
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
                <Text
                    theme={descriptor}
                    variant="title"
                    tone="primary"
                    weight="700"
                >
                    Theme
                </Text>
            </View>
            <ScrollView
                style={styles.body}
                contentContainerStyle={{
                    paddingBottom: insets.bottom + descriptor.spacing.xl,
                }}
            >
                <View style={styles.sectionHeaderBox}>
                    <Text
                        theme={descriptor}
                        variant="caption"
                        tone="secondary"
                        weight="600"
                        style={{ letterSpacing: 0.5 }}
                    >
                        DARK
                    </Text>
                </View>
                {darkThemes.map(t => (
                    <Pressable
                        key={t.value}
                        onPress={() => setTheme(t.value)}
                        style={[
                            styles.option,
                            themeName === t.value
                                ? styles.optionSelected
                                : styles.optionUnselected,
                        ]}
                    >
                        <View
                            style={[
                                styles.swatch,
                                {
                                    backgroundColor:
                                        themes[t.value].colors.accent,
                                },
                            ]}
                        />
                        <View style={styles.optionLabelBox}>
                            <Text
                                theme={descriptor}
                                variant="body"
                                tone="primary"
                                weight="500"
                            >
                                {t.label}
                            </Text>
                        </View>
                        {themeName === t.value && (
                            <Check
                                width={18}
                                height={18}
                                color={theme.accent}
                            />
                        )}
                    </Pressable>
                ))}

                <View
                    style={[
                        styles.sectionHeaderBox,
                        styles.sectionHeaderSpacer,
                    ]}
                >
                    <Text
                        theme={descriptor}
                        variant="caption"
                        tone="secondary"
                        weight="600"
                        style={{ letterSpacing: 0.5 }}
                    >
                        LIGHT
                    </Text>
                </View>
                {lightThemes.map(t => (
                    <Pressable
                        key={t.value}
                        onPress={() => setTheme(t.value)}
                        style={[
                            styles.option,
                            themeName === t.value
                                ? styles.optionSelected
                                : styles.optionUnselected,
                        ]}
                    >
                        <View
                            style={[
                                styles.swatch,
                                {
                                    backgroundColor:
                                        themes[t.value].colors.accent,
                                },
                            ]}
                        />
                        <View style={styles.optionLabelBox}>
                            <Text
                                theme={descriptor}
                                variant="body"
                                tone="primary"
                                weight="500"
                            >
                                {t.label}
                            </Text>
                        </View>
                        {themeName === t.value && (
                            <Check
                                width={18}
                                height={18}
                                color={theme.accent}
                            />
                        )}
                    </Pressable>
                ))}
            </ScrollView>
        </View>
    );
}
