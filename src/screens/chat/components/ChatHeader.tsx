import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Menu } from 'iconoir-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createStyles } from '../styles';
import { useTheme } from '../../../context/ThemeContext';

interface ChatHeaderProps {
    title: string;
    subtitle: string;
    onMenuPress?: () => void;
    showMenu?: boolean;
}

export function ChatHeader({ title, subtitle, onMenuPress, showMenu = true }: ChatHeaderProps) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const styles = useMemo(() => createStyles(theme), [theme]);

    return (
        <View style={[
            styles.header,
            {
                paddingTop: insets.top,
                height: 60 + insets.top,
                backgroundColor: `${theme.accent}1F`, // Match input field background
                borderBottomLeftRadius: 24,
                borderBottomRightRadius: 24,
                borderBottomWidth: 1,
                borderBottomColor: `${theme.accent}40`, // Match input field border
            }
        ]}>
            {showMenu && (
                <TouchableOpacity style={styles.menuButton} onPress={onMenuPress}>
                    <Menu width={22} height={22} color={theme.textPrimary} strokeWidth={2} />
                </TouchableOpacity>
            )}
            <View style={styles.headerAvatar}>
                <Text style={styles.headerAvatarText}>G</Text>
            </View>
            <View style={styles.headerBody}>
                <Text style={styles.headerTitle}>{title}</Text>
                <Text style={styles.headerSubtitle}>{subtitle}</Text>
            </View>
            <View style={styles.headerBadge}>
                <Text style={styles.headerBadgeText}>AI</Text>
            </View>
        </View>
    );
}
