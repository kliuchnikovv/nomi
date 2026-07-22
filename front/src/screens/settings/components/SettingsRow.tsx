import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { NavArrowRight } from 'iconoir-react-native';
import { Text } from '@genie/ds';
import { useTheme } from '../../../context/ThemeContext';
import { themes } from '../../../themes';
import { createComponentStyles } from './settingsComponentStyles';

type Props = {
    label: string;
    value?: string;
    onPress?: () => void;
    destructive?: boolean;
    isFirst?: boolean;
    isLast?: boolean;
};

export function SettingsRow({
    label,
    value,
    onPress,
    destructive,
    isFirst,
}: Props) {
    const { theme, themeName, descriptor } = useTheme();
    const palette = themes[themeName].palette;
    const styles = useMemo(
        () => createComponentStyles(theme, palette),
        [theme, palette],
    );

    const content = (pressed: boolean) => (
        <>
            {!isFirst && <View style={styles.rowDivider} />}
            <View style={[styles.rowContainer, pressed && styles.pressedRow]}>
                <Text
                    theme={descriptor}
                    variant="body"
                    tone={destructive ? 'error' : 'primary'}
                    style={styles.rowLabel}
                    numberOfLines={1}
                >
                    {label}
                </Text>
                {value !== undefined && (
                    <Text
                        theme={descriptor}
                        variant="body"
                        tone="secondary"
                        style={styles.rowValue}
                        numberOfLines={1}
                    >
                        {value}
                    </Text>
                )}
                {onPress && (
                    <NavArrowRight
                        width={16}
                        height={16}
                        color={theme.fadedText}
                    />
                )}
            </View>
        </>
    );

    if (!onPress) {
        return <View>{content(false)}</View>;
    }

    return (
        <Pressable onPress={onPress}>
            {({ pressed }) => content(pressed)}
        </Pressable>
    );
}
