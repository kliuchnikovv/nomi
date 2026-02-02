import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Menu, Mail, MagicWand, Code, Airplane, Cube, Group } from 'iconoir-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createStyles } from '../styles';
import { useTheme } from '../../../context/ThemeContext';
import { TypingIndicator } from './TypingIndicator';


interface ChatHeaderProps {
    title: string;
    subtitle: string;
    onMenuPress?: () => void;
    onInboxPress?: () => void;
    showMenu?: boolean;
    showInbox?: boolean;
    isInboxMode?: boolean;
    icon?: string;
    chatMode?: 'agent' | 'team' | 'plugin';
    teamId?: string | null;
    activeAgentsCount?: number;
}

export function ChatHeader({
    title,
    subtitle,
    onMenuPress,
    onInboxPress,
    showMenu = true,
    showInbox = true,
    isInboxMode = false,
    icon,
    chatMode,
    teamId,
    activeAgentsCount = 0,
}: ChatHeaderProps) {
    const { theme, palette } = useTheme();
    const insets = useSafeAreaInsets();
    const styles = useMemo(() => createStyles(theme), [theme]);


    // Determine team/mode color
    const getTeamColor = () => {
        if (isInboxMode) return palette.orange;
        if (chatMode === 'agent') return theme.success; // Robot icon usually green
        if (chatMode === 'team') {
            if (teamId === 'dnd_team') return theme.accent;
            return theme.info;
        }
        return theme.accent;
    };

    const teamColor = getTeamColor();
    // Use team color for header tint if not in inbox mode
    const accentColor = isInboxMode ? palette.orange : teamColor;

    const renderIcon = () => {
        const size = 20; // Slightly smaller than container
        if (!icon) return null;

        // Use either teamColor or default text color based on background
        const iconColor = theme.background; // Reverse for better visibility on colored background

        switch (icon) {
            case 'sparkles': return <MagicWand width={size} height={size} color={iconColor} strokeWidth={2.5} />;
            case 'code': return <Code width={size} height={size} color={iconColor} strokeWidth={2.5} />;
            case 'plane': return <Airplane width={size} height={size} color={iconColor} strokeWidth={2.5} />;
            case 'd20': return <Cube width={size} height={size} color={iconColor} strokeWidth={2.5} />;
            default: return null;
        }
    };

    const iconElement = renderIcon();


    return (
        <View style={[
            styles.header,
            {
                paddingTop: insets.top,
                height: 60 + insets.top,
                backgroundColor: `${theme.accent}1F`,
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
            <View style={[styles.headerAvatar, { backgroundColor: teamColor }]}>
                {iconElement ? (
                    iconElement
                ) : (
                    <Text style={[styles.headerAvatarText, { color: theme.icon }]}>
                        {isInboxMode ? 'I' : chatMode === 'agent' ? 'G' : 'T'}
                    </Text>
                )}
            </View>
            <View style={[styles.headerBody, { flex: 1, minWidth: 0 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.headerTitle} numberOfLines={1} ellipsizeMode="tail">
                            {title}
                        </Text>
                    </View>
                    {subtitle ? (
                        subtitle === 'typing...' ? (
                            <TypingIndicator />
                        ) : (
                            <Text style={[styles.headerSubtitle, { marginTop: 0, marginLeft: 6, flexShrink: 0 }]} numberOfLines={1}>
                                {subtitle}
                            </Text>
                        )
                    ) : null}
                    {activeAgentsCount > 0 && (
                        <View style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: theme.success + '20',
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            borderRadius: 8,
                            marginLeft: 8,
                        }}>
                            <Group width={12} height={12} color={theme.success} strokeWidth={2.5} />
                            <Text style={{
                                fontSize: 10,
                                fontWeight: '700',
                                color: theme.success,
                                marginLeft: 4
                            }}>
                                {activeAgentsCount}
                            </Text>
                        </View>
                    )}
                </View>
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
