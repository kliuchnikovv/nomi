import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@genie/front/context/ThemeContext';
import { ThemePalette } from '@genie/front/themes/types';
import { INTEGRATION_REGISTRY } from '@genie/front/services/integrations/registry';

interface PluginIconProps {
    provider: string;
    size?: number;
    color?: string;
}

const ICON_SIZE = 16;
const CUSTOM_ICONS: Record<string, any> = {
    gmail: require('iconoir-react-native').Mail,
    calendar: require('iconoir-react-native').Calendar,
    github: require('iconoir-react-native').Github,
    jules: require('iconoir-react-native').Robot,
    telegram: require('iconoir-react-native').SendDiagonal,
    ios_calendar: require('iconoir-react-native').Calendar,
    ios_reminders: require('iconoir-react-native').CheckSquare,
    ios_contacts: require('iconoir-react-native').User,
    ios_health: require('iconoir-react-native').Heart,
};

export function PluginIcon({ provider, size = ICON_SIZE, color }: PluginIconProps) {
    const { palette } = useTheme();
    
    const iconKey = provider.toLowerCase();
    const IconComponent = CUSTOM_ICONS[iconKey] || require('iconoir-react-native').Circle;
    
    // Get color from registry first, then fall back to defaults
    const metadata = INTEGRATION_REGISTRY[iconKey];
    const iconColor = color || metadata?.color || getProviderColor(iconKey, palette);
    
    return (
        <View style={styles.container}>
            <IconComponent
                width={size}
                height={size}
                color={iconColor}
                strokeWidth={1.5}
            />
        </View>
    );
}

function getProviderColor(provider: string, palette: ThemePalette): string {
    const colorMap: Record<string, string> = {
        gmail: palette.red,
        calendar: palette.orange,
        github: '#6e7681',
        jules: palette.purple,
    };
    
    return colorMap[provider] || palette.fg;
}

const styles = StyleSheet.create({
    container: {
        justifyContent: 'center',
        alignItems: 'center',
    },
});