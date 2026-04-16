import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import { themes } from '../../../themes';
import { createComponentStyles } from './settingsComponentStyles';

type Props = {
    header: string;
    children: React.ReactNode;
};

export function SettingsSection({ header, children }: Props) {
    const { theme, themeName } = useTheme();
    const palette = themes[themeName].palette;
    const styles = useMemo(() => createComponentStyles(theme, palette), [theme, palette]);

    return (
        <View>
            <Text style={styles.sectionHeader}>{header}</Text>
            <View style={styles.sectionCard}>{children}</View>
        </View>
    );
}
