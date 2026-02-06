/**
 * Telegram client plugin: Telegram is a server-side integration.
 * This executor handles client-side actions if any are needed.
 */

import type { ClientPluginHandler } from '@genie/front/plugins/clientRegistry';

export const telegramPlugin: ClientPluginHandler = {
    async execute(method: string, params: Record<string, any>): Promise<string> {
        // Telegram is a server-side integration
        // Client-side execution is not supported
        throw new Error('Telegram is a server-side integration. Please use the server-side tools.');
    },
};
