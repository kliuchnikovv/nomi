import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Text } from '@nomi/ds';
import { useTheme } from '../../../context/ThemeContext';
import { themes } from '../../../themes';
import { createComponentStyles } from './settingsComponentStyles';

type Props = {
    header: string;
    children: React.ReactNode;
};

export function SettingsSection({ header, children }: Props) {
    const { theme, themeName, descriptor } = useTheme();
    const palette = themes[themeName].palette;
    const styles = useMemo(
        () => createComponentStyles(theme, palette),
        [theme, palette],
    );

    return (
        <View>
            <Text
                theme={descriptor}
                variant="caption"
                tone="secondary"
                weight="600"
                style={styles.sectionHeader}
            >
                {header}
            </Text>
            <View style={styles.sectionCard}>{children}</View>
        </View>
    );
}
