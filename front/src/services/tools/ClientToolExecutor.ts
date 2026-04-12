import { getIntegrationMetadata } from '../integrations/registry';
import { getClientPluginHandler, getClientPlugin } from '../../plugins/clientRegistry';
import { registerClientPlugins } from '../../plugins/registerClientPlugins';
import { callApplyPatches } from '../../screens/planner/planDocumentRegistry';

export interface ClientToolAction {
    tool: string;
    method: string;
    params: Record<string, any>;
    integration_id?: string;
}

export class ClientToolExecutor {
    /**
     * Execute a client-side tool action
     */
    async execute(action: ClientToolAction): Promise<string> {
        registerClientPlugins();

        console.log(`[ClientToolExecutor] Executing ${action.tool}.${action.method}`, action.params);

        // Special handling for ask_user tool (built-in, not an integration)
        if (action.tool === 'ask_user') {
            return await this.executeAskUserAction(action.method, action.params);
        }

        // Special handling for patch_plan_document (built-in, planner screen)
        if (action.tool === 'patch_plan_document') {
            const patches = action.params?.patches as any[];
            const summary = action.params?.summary as string | undefined;
            callApplyPatches(patches ?? [], summary);
            return 'ok';
        }

        const metadata = getIntegrationMetadata(action.tool);
        if (metadata?.storageType === 'server') {
            throw new Error(`Tool ${action.tool} is not a client-side tool. It should be executed on the server.`);
        }

        let handler = getClientPluginHandler(action.tool);
        let resolvedIntegrationId = action.integration_id;

        // If no exact match and we have integration_id, try fallback to base provider
        // e.g., "gmail_uuid123_send_email" -> fallback to "gmail"
        if (!handler && action.integration_id) {
            const toolBase = action.tool.split('_')[0];
            handler = getClientPluginHandler(toolBase);
            if (handler) {
                console.log(`[ClientToolExecutor] Falling back to base provider "${toolBase}" for integration ${action.integration_id}`);
            }
        }

        if (handler) {
            const paramsWithIntegration = {
                ...action.params,
                integration_id: resolvedIntegrationId,
            };
            return await handler.execute(action.method, paramsWithIntegration);
        }
        if (metadata) {
            throw new Error(`Tool ${action.tool} is registered but not implemented in ClientToolExecutor`);
        }
        throw new Error(`Unknown tool: ${action.tool}`);
    }

    private async executeAskUserAction(method: string, params: Record<string, any>): Promise<string> {
        console.log('[ClientToolExecutor] Executing AskUser action', params);

        const { question, options } = params;

        if (method !== 'ask') {
            throw new Error(`Unknown AskUser method: ${method}`);
        }

        // Access the global AskUser dialog function (set by ChatProvider)
        const askUserDialog = (globalThis as any).__askUserDialog;
        if (!askUserDialog) {
            throw new Error('AskUser dialog not available');
        }

        return await askUserDialog(question, options || []);
    }

}

export const clientToolExecutor = new ClientToolExecutor();
