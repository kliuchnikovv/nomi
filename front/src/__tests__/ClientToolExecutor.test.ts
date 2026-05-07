/**
 * Tests for ClientToolExecutor fixes:
 *  - #10: Errors thrown via `throw` instead of returned as error strings
 *  - #12: No hardcoded debug URLs (127.0.0.1:7242)
 */

import { ClientToolExecutor } from '../services/tools/ClientToolExecutor';

// Mock the plugin registry
jest.mock('../plugins/clientRegistry', () => ({
    getClientPluginHandler: jest.fn(),
    getClientPlugin: jest.fn(),
}));

jest.mock('../plugins/registerClientPlugins', () => ({
    registerClientPlugins: jest.fn(),
}));

jest.mock('../screens/planner/planDocumentRegistry', () => ({
    callApplyPatches: jest.fn(),
}));

jest.mock('../services/integrations/registry', () => ({
    getIntegrationMetadata: jest.fn(),
}));

import { getClientPluginHandler } from '../plugins/clientRegistry';
import { getIntegrationMetadata } from '../services/integrations/registry';

const mockedGetHandler = getClientPluginHandler as jest.MockedFunction<typeof getClientPluginHandler>;
const mockedGetMetadata = getIntegrationMetadata as jest.MockedFunction<typeof getIntegrationMetadata>;

describe('ClientToolExecutor', () => {
    let executor: ClientToolExecutor;

    beforeEach(() => {
        executor = new ClientToolExecutor();
        jest.clearAllMocks();
    });

    // ── #10: Unknown tool throws instead of returning error string ──

    it('should throw an error for unknown tools instead of returning error string', async () => {
        mockedGetMetadata.mockReturnValue(undefined);

        await expect(
            executor.execute({ tool: 'unknown_tool', method: 'do', params: {} }),
        ).rejects.toThrow('Unknown tool: unknown_tool');
    });

    it('should throw when tool is registered but not implemented', async () => {
        mockedGetMetadata.mockReturnValue({ storageType: 'client' } as any);
        mockedGetHandler.mockReturnValue(undefined);

        await expect(
            executor.execute({ tool: 'unimplemented', method: 'do', params: {} }),
        ).rejects.toThrow('registered but not implemented');
    });

    it('should throw for server-side tools', async () => {
        mockedGetMetadata.mockReturnValue({ storageType: 'server' } as any);

        await expect(
            executor.execute({ tool: 'server_tool', method: 'do', params: {} }),
        ).rejects.toThrow('not a client-side tool');
    });

    it('should propagate handler exceptions as rejections (not catch and return string)', async () => {
        mockedGetMetadata.mockReturnValue(undefined);
        const handler = {
            execute: jest.fn().mockRejectedValue(new Error('handler crashed')),
        };
        mockedGetHandler.mockReturnValue(handler as any);

        // Before the fix, this would resolve with "Error executing default..."
        // After the fix, this should reject
        await expect(
            executor.execute({ tool: 'mytool', method: 'do', params: {} }),
        ).rejects.toThrow('handler crashed');
    });

    it('should return successful handler result unchanged', async () => {
        mockedGetMetadata.mockReturnValue(undefined);
        const handler = {
            execute: jest.fn().mockResolvedValue('success result'),
        };
        mockedGetHandler.mockReturnValue(handler as any);

        const result = await executor.execute({ tool: 'mytool', method: 'do', params: {} });
        expect(result).toBe('success result');
    });

    // ── #12: AskUser throws when dialog not available ──

    it('should throw when AskUser dialog is not available', async () => {
        // Ensure no global dialog is set
        delete (globalThis as any).__askUserDialog;

        await expect(
            executor.execute({ tool: 'ask_user', method: 'ask', params: { question: 'hi' } }),
        ).rejects.toThrow('AskUser dialog not available');
    });
});
