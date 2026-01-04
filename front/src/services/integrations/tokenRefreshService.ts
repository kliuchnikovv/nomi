/**
 * Token Refresh Service
 * Handles automatic token refresh before expiry
 */

import { integrationStorage, IntegrationCredentials } from './IntegrationStorage';
import { getApiUrl } from '../../config';

// Refresh tokens 5 minutes before expiry
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

class TokenRefreshService {
    /**
     * Get a valid access token, refreshing if needed
     */
    async getValidToken(integrationId: string): Promise<string> {
        const creds = await integrationStorage.getCredentials(integrationId);
        if (!creds) {
            throw new Error('No credentials found for integration');
        }

        // Check if token is still valid (with buffer)
        if (creds.tokenExpiry && creds.tokenExpiry.getTime() > Date.now() + REFRESH_BUFFER_MS) {
            return creds.accessToken;
        }

        // Token expired or about to expire - refresh it
        return this.forceRefresh(integrationId);
    }

    /**
     * Force refresh the token regardless of expiry
     */
    async forceRefresh(integrationId: string): Promise<string> {
        const integration = await integrationStorage.getIntegration(integrationId);
        if (!integration) {
            throw new Error('Integration not found');
        }

        const creds = await integrationStorage.getCredentials(integrationId);
        if (!creds?.refreshToken) {
            throw new Error('No refresh token available - please re-authenticate');
        }

        console.log(`[TokenRefresh] Refreshing token for ${integration.provider}...`);

        const apiUrl = getApiUrl();
        const response = await fetch(`${apiUrl}/oauth/refresh`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                provider: integration.provider,
                refresh_token: creds.refreshToken,
            }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Token refresh failed');
        }

        const data = await response.json();

        // Update stored credentials
        const newExpiry = new Date(data.token_expiry * 1000);
        await integrationStorage.updateCredentials(integrationId, {
            accessToken: data.access_token,
            tokenExpiry: newExpiry,
        });

        console.log(`[TokenRefresh] Token refreshed, expires at ${newExpiry.toISOString()}`);

        return data.access_token;
    }

    /**
     * Check if credentials need refresh
     */
    async needsRefresh(integrationId: string): Promise<boolean> {
        const creds = await integrationStorage.getCredentials(integrationId);
        if (!creds?.tokenExpiry) {
            return true;
        }
        return creds.tokenExpiry.getTime() <= Date.now() + REFRESH_BUFFER_MS;
    }
}

export const tokenRefreshService = new TokenRefreshService();
