/**
 * Token Refresh Service
 * Handles automatic token refresh before expiry
 */

import { integrationStorage } from './IntegrationStorage';
import { secureTokenStorage } from '../auth/SecureTokenStorage';
import { getApiUrl } from '../../config';

// Refresh tokens 5 minutes before expiry
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

class TokenRefreshService {
    /**
     * Get a valid access token, refreshing if needed
     */
    async getValidToken(integrationId: string): Promise<string> {
        // Try secure storage first
        let tokens = await secureTokenStorage.getToken(integrationId);

        // Fallback to database (during migration)
        if (!tokens) {
            const creds = await integrationStorage.getCredentials(integrationId);
            if (creds) {
                // Migrate to secure storage
                await secureTokenStorage.saveToken(integrationId, {
                    accessToken: creds.accessToken,
                    refreshToken: creds.refreshToken,
                    expiry: creds.tokenExpiry ? creds.tokenExpiry.getTime() : 0
                });
                tokens = {
                    accessToken: creds.accessToken,
                    refreshToken: creds.refreshToken,
                    expiry: creds.tokenExpiry ? creds.tokenExpiry.getTime() : 0
                };
            }
        }

        if (!tokens) {
            throw new Error('No credentials found for integration');
        }

        // Check if token is still valid (with buffer)
        if (tokens.expiry && tokens.expiry > Date.now() + REFRESH_BUFFER_MS) {
            return tokens.accessToken;
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

        let tokens = await secureTokenStorage.getToken(integrationId);
        // Fallback check
        if (!tokens) {
            const creds = await integrationStorage.getCredentials(integrationId);
            if (creds) {
                tokens = {
                    accessToken: creds.accessToken,
                    refreshToken: creds.refreshToken,
                    expiry: creds.tokenExpiry ? creds.tokenExpiry.getTime() : 0
                };
            }
        }

        if (!tokens?.refreshToken) {
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
                refresh_token: tokens.refreshToken,
            }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Token refresh failed');
        }

        const data = await response.json();

        // Update stored credentials
        const newExpiry = data.token_expiry * 1000;

        await secureTokenStorage.saveToken(integrationId, {
            accessToken: data.access_token,
            refreshToken: tokens.refreshToken, // Reuse existing refresh token unless new one provided
            expiry: newExpiry,
        });

        // Also update legacy DB for compatibility if needed, or just clear it?
        // Ideally we wipe creds from DB to force usage of SecureStore
        await integrationStorage.updateCredentials(integrationId, {
            accessToken: data.access_token,
            tokenExpiry: new Date(newExpiry),
        });

        console.log(`[TokenRefresh] Token refreshed, expires at ${new Date(newExpiry).toISOString()}`);

        return data.access_token;
    }

    /**
     * Check if credentials need refresh
     */
    async needsRefresh(integrationId: string): Promise<boolean> {
        const tokens = await secureTokenStorage.getToken(integrationId);
        if (!tokens?.expiry) {
            return true;
        }
        return tokens.expiry <= Date.now() + REFRESH_BUFFER_MS;
    }
}

export const tokenRefreshService = new TokenRefreshService();
