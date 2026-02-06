/**
 * Renders all registered plugin widgets sorted by priority.
 */

import React from 'react';
import { View } from 'react-native';
import { getRegisteredWidgets } from '../plugins/widgetRegistry';

export interface PluginWidgetsProps {
    integrationId?: string;
}

export function PluginWidgets({ integrationId }: PluginWidgetsProps) {
    const widgets = getRegisteredWidgets();
    if (widgets.length === 0) return null;

    return (
        <View>
            {widgets.map(w => (
                <w.Component key={w.id} integrationId={integrationId} />
            ))}
        </View>
    );
}
