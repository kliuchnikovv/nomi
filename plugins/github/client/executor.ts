/**
 * GitHub client plugin: GitHub is server-only integration.
 * This executor handles client-side actions if any are needed.
 */

import type { ClientPluginHandler } from '@nomi/front/plugins/clientRegistry';

export const githubPlugin: ClientPluginHandler = {
    async execute(method: string, params: Record<string, any>): Promise<string> {
        // GitHub is a server-only integration
        // Client-side execution is not supported
        throw new Error('GitHub is a server-only integration. Please use the server-side tools.');
    },
};
