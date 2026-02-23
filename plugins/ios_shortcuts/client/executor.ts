/**
 * iOS Shortcuts client plugin: executes iOS Shortcuts tool actions.
 */

import * as FileSystem from 'expo-file-system';
import type { ClientPluginHandler } from '@genie/front/plugins/clientRegistry';
import { IOSShortcutsClient } from '@genie/front/services/integrations/clients/IOSShortcutsClient';

export const iosShortcutsPlugin: ClientPluginHandler = {
    async execute(method: string, params: Record<string, any>): Promise<string> {
        const client = new IOSShortcutsClient();

        switch (method) {
            case 'list_shortcuts': {
                const shortcuts = await client.listAllShortcuts();
                if (shortcuts.length === 0) {
                    return 'No shortcuts found. You can add shortcuts manually using add_shortcut_to_list.';
                }
                const sirikit = shortcuts.filter(s => s.source === 'sirikit');
                const manual = shortcuts.filter(s => s.source === 'manual');
                let result = `Found ${shortcuts.length} shortcuts:\n\n`;
                if (sirikit.length > 0) {
                    result += `**SiriKit Shortcuts (${sirikit.length}):**\n`;
                    sirikit.forEach(s => {
                        result += `- ${s.name}`;
                        if (s.phrase) result += ` (phrase: "${s.phrase}")`;
                        result += '\n';
                    });
                    result += '\n';
                }
                if (manual.length > 0) {
                    result += `**Manual List (${manual.length}):**\n`;
                    manual.forEach(s => {
                        result += `- ${s.name}`;
                        if (s.description) result += `: ${s.description}`;
                        result += '\n';
                    });
                }
                return result;
            }

            case 'run_shortcut': {
                const result = await client.runShortcut(params.name, params.input);
                if (result.launched) {
                    return `Launched shortcut "${params.name}". The Shortcuts app should open now.`;
                }
                return `Failed to launch shortcut "${params.name}".`;
            }

            case 'get_shortcut_info': {
                const shortcuts = await client.listAllShortcuts();
                const shortcut = shortcuts.find(s => 
                    s.name.toLowerCase() === params.name.toLowerCase()
                );
                if (!shortcut) {
                    return `Shortcut "${params.name}" not found.`;
                }
                let info = `**Shortcut: ${shortcut.name}**\n`;
                info += `- Source: ${shortcut.source}\n`;
                if (shortcut.phrase) {
                    info += `- Siri Phrase: ${shortcut.phrase}\n`;
                }
                if (shortcut.description) {
                    info += `- Description: ${shortcut.description}\n`;
                }
                if (shortcut.id) {
                    info += `- ID: ${shortcut.id}\n`;
                }
                return info;
            }

            case 'donate_shortcut': {
                const result = await client.donateShortcut(params.name, params.suggested_phrase);
                if (result.donated) {
                    return `Donated shortcut "${params.name}" to Siri with phrase "${params.suggested_phrase}". You can now invoke it using Siri.`;
                }
                return `Failed to donate shortcut "${params.name}".`;
            }

            case 'add_shortcut_to_list': {
                await client.addToManualList(params.name, params.description);
                return `Added shortcut "${params.name}" to your manual list.`;
            }

            case 'remove_shortcut_from_list': {
                await client.removeFromManualList(params.name);
                return `Removed shortcut "${params.name}" from your manual list.`;
            }

            case 'create_shortcut': {
                const { name, shortcut_data } = params;
                if (!shortcut_data) {
                    return 'Error: shortcut_data (base64-encoded .shortcut plist) is required.';
                }

                // Write base64 .shortcut file to cache directory
                const cacheDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
                if (!cacheDir) {
                    return 'Error: No writable directory available on this device.';
                }
                const safeName = (name || 'shortcut').replace(/[^a-zA-Z0-9_-]/g, '_');
                const fileUri = `${cacheDir}${safeName}.shortcut`;

                await FileSystem.writeAsStringAsync(fileUri, shortcut_data, {
                    encoding: FileSystem.EncodingType.Base64,
                });

                // Open via shortcuts://import-shortcut?url=<fileUri>&name=<name>
                const result = await client.importShortcut(fileUri, name || 'New Shortcut');

                if (result.opened) {
                    return `Shortcuts app opened with import dialog for "${name || 'New Shortcut'}". Tap "Add Shortcut" to confirm.`;
                }
                return 'Failed to open Shortcuts app. Make sure the Shortcuts app is installed (iOS 13+).';
            }

            default:
                throw new Error(`Unknown iOS Shortcuts method: ${method}`);
        }
    },
};
