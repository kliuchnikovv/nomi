import React, { useMemo } from 'react';
import { Switch, Text, View } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import { themes } from '../../../themes';
import { createComponentStyles } from './settingsComponentStyles';

type Props = {
    label: string;
    subtitle?: string;
    value: boolean;
    onToggle: (value: boolean) => void;
    isFirst?: boolean;
    isLast?: boolean;
};

export function SettingsToggleRow({ label, subtitle, value, onToggle, isFirst }: Props) {
    const { theme, themeName } = useTheme();
    const palette = themes[themeName].palette;
    const styles = useMemo(() => createComponentStyles(theme, palette), [theme, palette]);

    return (
        <View>
            {!isFirst && <View style={styles.rowDivider} />}
            <View style={styles.rowContainer}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.toggleLabel}>{label}</Text>
                    {subtitle && <Text style={styles.toggleSubtitle}>{subtitle}</Text>}
                </View>
                <Switch value={value} onValueChange={onToggle} />
            </View>
        </View>
    );
}
