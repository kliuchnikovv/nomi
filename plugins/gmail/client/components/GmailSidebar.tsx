import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Mail } from 'iconoir-react-native';
import { useTheme } from '@genie/front/context/ThemeContext';
import { PluginSidebarProps } from '@genie/front/plugins/types';
import { integrationStorage } from '@genie/front/services/integrations/IntegrationStorage';

export function GmailSidebar({ integrationId, onSelect, isSelected }: PluginSidebarProps) {
    const { theme, palette } = useTheme();
    const [accountEmail, setAccountEmail] = useState<string>('Gmail');

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

    const truncateText = (text: string, maxLength: number = 25): string => {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    };

    const displayName = accountEmail === 'Gmail' ? accountEmail : truncateText(accountEmail);

    return (
        <View>
            <Pressable
                style={[
                    styles.header,
                    isSelected && { backgroundColor: `${theme.accent}15` }
                ]}
                onPress={onSelect}
            >
                <View style={styles.headerLeft}>
                    <Mail width={20} height={20} color={palette.red} />
                    <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
                        {displayName}
                    </Text>
                </View>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(150, 150, 150, 0.2)',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '600',
    },
});
