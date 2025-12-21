import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Menu, Mail } from 'iconoir-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createStyles } from '../styles';
import { useTheme } from '../../../context/ThemeContext';

interface ChatHeaderProps {
    title: string;
    subtitle: string;
    onMenuPress?: () => void;
    onInboxPress?: () => void;
    showMenu?: boolean;
    showInbox?: boolean;
    isInboxMode?: boolean;
}

export function ChatHeader({
    title,
    subtitle,
    onMenuPress,
    onInboxPress,
    showMenu = true,
    showInbox = true,
    isInboxMode = false,
}: ChatHeaderProps) {
    const { theme, palette } = useTheme();
    const insets = useSafeAreaInsets();
    const styles = useMemo(() => createStyles(theme), [theme]);

    // Change accent color based on mode
    const accentColor = isInboxMode ? palette.orange : theme.accent;

    return (
        <View style={[
            styles.header,
            {
                paddingTop: insets.top,
                height: 60 + insets.top,
                backgroundColor: `${accentColor}1F`,
                borderBottomLeftRadius: 24,
                borderBottomRightRadius: 24,
                borderBottomWidth: 1,
                borderBottomColor: `${accentColor}40`,
            }
        ]}>
            {showMenu && (
                <TouchableOpacity style={styles.menuButton} onPress={onMenuPress}>
                    <Menu width={22} height={22} color={theme.textPrimary} strokeWidth={2} />
                </TouchableOpacity>
            )}
            <View style={styles.headerAvatar}>
                <Text style={styles.headerAvatarText}>{isInboxMode ? 'I' : 'G'}</Text>
            </View>
            <View style={[styles.headerBody, { flex: 1, minWidth: 0 }]}>
                <Text style={styles.headerTitle} numberOfLines={2} ellipsizeMode="tail">
                    {title}
                </Text>
                {subtitle ? (
                    <Text style={styles.headerSubtitle} numberOfLines={1}>
                        {subtitle}
                    </Text>
                ) : null}
            </View>
            {showInbox && onInboxPress && (
                <TouchableOpacity style={styles.menuButton} onPress={onInboxPress}>
                    <Mail
                        width={22}
                        height={22}
                        color={isInboxMode ? palette.orange : theme.textPrimary}
                        strokeWidth={2}
                    />
                </TouchableOpacity>
            )}

        </View>
    );
}
