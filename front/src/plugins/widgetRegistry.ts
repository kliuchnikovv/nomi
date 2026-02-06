/**
 * Registry of dashboard widget components.
 *
 * Plugins register widgets that appear on the main dashboard / chat header area.
 * Widgets are sorted by priority (lower = higher on screen).
 */

import { PluginWidgetRegistration } from './types';

const widgets: PluginWidgetRegistration[] = [];

export function registerWidget(widget: PluginWidgetRegistration): void {
    if (widgets.find(w => w.id === widget.id)) return;
    widgets.push(widget);
    widgets.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

export function getRegisteredWidgets(): PluginWidgetRegistration[] {
    return [...widgets];
}
