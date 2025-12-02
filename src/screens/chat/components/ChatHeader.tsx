import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Menu } from 'iconoir-react-native';
import { styles } from '../styles';
import { palette } from '../theme';

interface ChatHeaderProps {
    title: string;
    subtitle: string;
    onMenuPress?: () => void;
    showMenu?: boolean;
}

export function ChatHeader({ title, subtitle, onMenuPress, showMenu = true }: ChatHeaderProps) {
    return (
        <View style={styles.header}>
            {showMenu && (
                <TouchableOpacity style={styles.menuButton} onPress={onMenuPress}>
                    <Menu width={22} height={22} color={palette.textPrimary} strokeWidth={2} />
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
