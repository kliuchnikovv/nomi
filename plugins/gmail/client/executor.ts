/**
 * Gmail client plugin: stub executor for server-only execution.
 * All Gmail operations are now handled server-side via the Python tools.py.
 */

import type { ClientPluginHandler } from "@nomi/front/plugins/clientRegistry";

export const gmailPlugin: ClientPluginHandler = {
  async execute(method: string, params: Record<string, any>): Promise<string> {
    // This stub indicates the method should be executed server-side
    // The plugin system will automatically route to the Python backend
    throw new Error(
      `Gmail method '${method}' should be executed server-side. ` +
        "Make sure the plugin is configured as server-only in manifest.yaml."
    );
  },
};
