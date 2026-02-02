import { getIntegrationMetadata, isClientOnly } from '../integrations/registry';
import { getClientPluginHandler } from '../../plugins/clientRegistry';
import { registerClientPlugins } from '../../plugins/registerClientPlugins';

export interface ClientToolAction {
    tool: string;
    method: string;
    params: Record<string, any>;
}

export class ClientToolExecutor {
    /**
     * Execute a client-side tool action
     */
    async execute(action: ClientToolAction): Promise<string> {
        registerClientPlugins();

        console.log(`[ClientToolExecutor] Executing ${action.tool}.${action.method}`, action.params);

        const metadata = getIntegrationMetadata(action.tool);
        if (metadata && !isClientOnly(action.tool)) {
            throw new Error(`Tool ${action.tool} is not a client-side tool. It should be executed on the server.`);
        }

        try {
            if (action.tool === 'rag') {
                return await this.executeRagAction(action.method, action.params);
            }
            const handler = getClientPluginHandler(action.tool);
            if (handler) {
                return await handler.execute(action.method, action.params);
            }
            if (metadata) {
                throw new Error(`Tool ${action.tool} is registered but not implemented in ClientToolExecutor`);
            }
            throw new Error(`Unknown tool: ${action.tool}`);
        } catch (error: any) {
            console.error(`[ClientToolExecutor] Execution failed:`, error);
            return `Error executing default.${action.tool}.${action.method}: ${error.message || String(error)}`;
        }
    }

    private async executeRagAction(method: string, params: Record<string, any>): Promise<string> {
        console.log(`[Client Tool Executor] Executing RAG action - method=${method} params=${JSON.stringify(params)}`);

        const { vectorStore } = await import('../database/VectorStore');

        switch (method) {
            case 'search':
                console.log('[Client Tool Executor] Starting local RAG search...');
                const searchStartTime = Date.now();

                const results = await vectorStore.search(
                    params.query,
                    params.limit || 5,
                    params.source_type || undefined
                );

                const searchTime = Date.now() - searchStartTime;
                console.log(`[Client Tool Executor] Local RAG search completed in ${searchTime}ms - found ${results.length} results`);

                if (results.length === 0) {
                    console.log('[Client Tool Executor] No results found in local knowledge base');
                    return 'No relevant information found in local knowledge base.';
                }

                const formattedResults = results.map((r, idx) => {
                    const meta = r.metadata ? ` (${Object.entries(r.metadata).map(([k, v]) => `${k}: ${v}`).join(', ')})` : '';
                    return `${idx + 1}. [Score: ${r.score.toFixed(3)}]${meta}\n${r.content}`;
                }).join('\n\n---\n\n');

                const response = `Found ${results.length} relevant items:\n\n${formattedResults}`;
                console.log(`[Client Tool Executor] Formatted response: ${response.length} characters`);
                return response;

            default:
                throw new Error(`Unknown RAG method: ${method}`);
        }
    }
}

export const clientToolExecutor = new ClientToolExecutor();
