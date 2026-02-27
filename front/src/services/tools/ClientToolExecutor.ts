import { getIntegrationMetadata } from '../integrations/registry';
import { getClientPluginHandler, getClientPlugin } from '../../plugins/clientRegistry';
import { registerClientPlugins } from '../../plugins/registerClientPlugins';

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

        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'front/src/services/tools/ClientToolExecutor.ts:18',message:'ClientToolExecutor.execute called',data:{tool:action.tool,method:action.method,params:action.params},timestamp:Date.now()})}).catch(()=>{});
        // #endregion

        const metadata = getIntegrationMetadata(action.tool);
        if (metadata?.storageType === 'server') {
            throw new Error(`Tool ${action.tool} is not a client-side tool. It should be executed on the server.`);
        }

        try {
            if (action.tool === 'rag') {
                return await this.executeRagAction(action.method, action.params);
            }

            let handler = getClientPluginHandler(action.tool);
            let resolvedIntegrationId = action.integration_id;

            // If no exact match and we have integration_id, try fallback to base provider
            // e.g., "gmail_uuid123_send_email" -> fallback to "gmail"
            if (!handler && action.integration_id) {
                // Extract base provider name from tool name (e.g., "gmail" from "gmail_uuid123_send_email")
                const toolBase = action.tool.split('_')[0];
                handler = getClientPluginHandler(toolBase);
                if (handler) {
                    console.log(`[ClientToolExecutor] Falling back to base provider "${toolBase}" for integration ${action.integration_id}`);
                }
            }

            if (handler) {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'front/src/services/tools/ClientToolExecutor.ts:32',message:'Handler found, executing',data:{tool:action.tool,method:action.method,integrationId:resolvedIntegrationId},timestamp:Date.now()})}).catch(()=>{});

                // Pass integration_id in params to handler
                const paramsWithIntegration = {
                    ...action.params,
                    integration_id: resolvedIntegrationId,
                };
                const result = await handler.execute(action.method, paramsWithIntegration);

                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'front/src/services/tools/ClientToolExecutor.ts:45',message:'Handler execution completed',data:{tool:action.tool,method:action.method,resultLength:result?.length},timestamp:Date.now()})}).catch(()=>{});

                return result;
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
