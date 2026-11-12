/**
 * Telegram client plugin: Telegram is a server-side integration.
 * This executor handles client-side actions if any are needed.
 */

import type { ClientPluginHandler } from '@nomi/front/plugins/clientRegistry';

export const telegramPlugin: ClientPluginHandler = {
    async execute(method: string, params: Record<string, any>): Promise<string> {
        throw new Error('Telegram is a server-side integration. Please use the server-side tools.');
    },
};
