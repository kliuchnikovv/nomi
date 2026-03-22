/**
 * Debug utilities for development and testing.
 * Access via: window.DEBUG or from React Native debugger console.
 */

import { manuallyTriggerBackgroundTask } from '../services/integrations/BackgroundTaskManager';
import { getIntegrationMetadata } from '../services/integrations/registry';

declare global {
    interface Window {
        DEBUG?: {
            triggerBackgroundTask: (provider: string) => Promise<void>;
            listBackgroundTasks: () => void;
            listIntegrations: () => void;
        };
    }
}

export function initDebugUtils() {
    if (typeof window !== 'undefined') {
        window.DEBUG = {
            /**
             * Manually trigger a background task
             * Usage: await window.DEBUG.triggerBackgroundTask('gmail')
             */
            triggerBackgroundTask: async (provider: string) => {
                console.log(`🧪 DEBUG: Manually triggering background task for ${provider}`);
                await manuallyTriggerBackgroundTask(provider);
            },

            /**
             * List all registered background tasks
             * Usage: window.DEBUG.listBackgroundTasks()
             */
            listBackgroundTasks: () => {
                console.log('🧪 DEBUG: Listing background tasks...');
                // This would need access to activeTasks - implement if needed
            },

            /**
             * List all integrations and their metadata
             * Usage: window.DEBUG.listIntegrations()
             */
            listIntegrations: () => {
                console.log('🧪 DEBUG: Listing integrations...');
                const providers = ['gmail', 'calendar', 'github', 'ios_reminders', 'ios_health', 'ios_shortcuts', 'notion'];
                for (const provider of providers) {
                    const metadata = getIntegrationMetadata(provider);
                    if (metadata) {
                        console.log(`  - ${provider}:`, {
                            displayName: metadata.displayName,
                            storageType: metadata.storageType,
                            supportsBackgroundTasks: metadata.supportsBackgroundTasks,
                        });
                    }
                }
            },
        };

        console.log('🧪 DEBUG: Debug utilities initialized. Access via window.DEBUG');
    }
}
