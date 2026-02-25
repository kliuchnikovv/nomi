import type { ClientPluginHandler } from '@genie/front/plugins/clientRegistry';
import { LocalDiscoveryEngine } from './LocalDiscoveryEngine';

export const appleDiscoveryPlugin: ClientPluginHandler = {
  async execute(method: string, params: Record<string, any>): Promise<string> {
    const engine = new LocalDiscoveryEngine();

    switch (method) {
      case 'discover_tools': {
        const tools = await engine.discoverTools(
          params.query,
          params.catalog || {}
        );

        if (tools.length === 0) {
          return 'No tools selected';
        }

        return `Selected tools: ${tools.join(', ')}`;
      }

      default:
        throw new Error(`Unknown apple_discovery method: ${method}`);
    }
  },
};
