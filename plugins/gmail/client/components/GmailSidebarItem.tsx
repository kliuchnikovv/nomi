import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Mail } from 'iconoir-react-native';
import { useTheme } from '@genie/front/context/ThemeContext';
import { ThemePalette } from '@genie/front/themes/types';
import { integrationStorage } from '@genie/front/services/integrations/IntegrationStorage';

interface GmailSidebarItemProps {
    integrationId: string;
    onSelect: () => void;
    isSelected: boolean;
}

export function GmailSidebarItem({ integrationId, onSelect, isSelected }: GmailSidebarItemProps) {
    const { theme, palette } = useTheme();
    const [accountEmail, setAccountEmail] = useState<string>('');
    const [unreadCount, setUnreadCount] = useState(0);

    useEffect(() => {
        const loadAccountInfo = async () => {
            try {
                const integrations = await integrationStorage.getIntegrations();
                const gmailIntegration = integrations.find(i => i.id === integrationId);
                if (gmailIntegration) {
                    setAccountEmail(gmailIntegration.name || 'Gmail');
                }
            } catch (error) {
                console.error('Failed to load Gmail account:', error);
                setAccountEmail('Gmail');
            }
        };
        loadAccountInfo();
    }, [integrationId]);

    return (
        <Pressable
            style={[
                styles.container,
                isSelected && { backgroundColor: `${theme.accent}15` }
            ]}
            onPress={onSelect}
        >
            <View style={styles.left}>
                <Mail width={20} height={20} color={palette.red} />
                <Text style={[styles.label, { color: theme.text }]}>{accountEmail}</Text>
            </View>
            {unreadCount > 0 && (
                <View style={[styles.badge, { backgroundColor: palette.red }]}>
                    <Text style={styles.badgeText}>{unreadCount}</Text>
                </View>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
        marginVertical: 2,
    },
    left: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    label: {
        fontSize: 15,
        fontWeight: '500',
    },
    badge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 10,
        minWidth: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    badgeText: {
        color: 'white',
        fontSize: 11,
        fontWeight: '700',
    },
});
