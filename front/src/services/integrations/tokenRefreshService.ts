/**
 * Token Refresh Service
 * Handles automatic token refresh before expiry using Client-Side SDKs where possible
 */

import { integrationStorage } from './IntegrationStorage';
import { secureTokenStorage } from '../auth/SecureTokenStorage';
import { getApiUrl } from '../../config';
import { apiClient } from '../../apiClient';

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
            const creds = await integrationStorage.getCredentials(
                integrationId,
            );
            if (creds) {
                // Migrate to secure storage
                await secureTokenStorage.saveToken(integrationId, {
                    accessToken: creds.accessToken ?? '',
                    refreshToken: creds.refreshToken ?? '',
                    expiry: creds.tokenExpiry ? creds.tokenExpiry.getTime() : 0,
                });
                tokens = {
                    accessToken: creds.accessToken ?? '',
                    refreshToken: creds.refreshToken ?? '',
                    expiry: creds.tokenExpiry ? creds.tokenExpiry.getTime() : 0,
                };
            }
        }

        if (!tokens) {
            // If we have no tokens but an integration exists, maybe we can try silent sign-in to recover?
            // This happens if the user cleared storage but is still logged in to Google System.
            try {
                return await this.forceRefresh(integrationId);
            } catch (e) {
                throw new Error(
                    'No credentials found for integration and recovery failed',
                );
            }
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
        const integration = await integrationStorage.getIntegration(
            integrationId,
        );
        if (!integration) {
            throw new Error('Integration not found');
        }

        console.log(
            `[TokenRefresh] Refreshing token for ${integration.provider}...`,
        );

        if (
            integration.provider === 'gmail' ||
            integration.provider === 'calendar'
        ) {
            return this.refreshGoogleToken(integrationId);
        }

        // Add other providers here if needed...

        throw new Error(
            `Auto-refresh not supported for provider: ${integration.provider}`,
        );
    }

    /**
     * Refresh a Google access token via the backend.
     *
     * Google integrations are connected through the server OAuth flow, which
     * stores the refresh token encrypted server-side (the device never holds
     * it). This asks the backend to mint a fresh access token from that stored
     * refresh token — the device only ever caches the short-lived access token.
     */
    private async refreshGoogleToken(integrationId: string): Promise<string> {
        const integration = await integrationStorage.getIntegration(
            integrationId,
        );
        if (!integration) {
            throw new Error('Integration not found');
        }

        try {
            const res = await apiClient.post<{
                access_token: string;
                token_expiry: number;
            }>(`${getApiUrl()}/oauth/${integration.provider}/access-token`, {});

            if (!res?.access_token) {
                throw new Error('No access_token in refresh response');
            }

            // Backend returns Unix seconds; fall back to ~1h if absent/invalid.
            const expiry =
                res.token_expiry && res.token_expiry > 0
                    ? res.token_expiry * 1000
                    : Date.now() + 3500 * 1000;

            await secureTokenStorage.saveToken(integrationId, {
                accessToken: res.access_token,
                refreshToken: 'server-managed',
                expiry,
            });

            // Sync with IntegrationStorage just in case legacy code reads it.
            await integrationStorage.updateCredentials(integrationId, {
                accessToken: res.access_token,
                tokenExpiry: new Date(expiry),
            });

            console.log(
                `[TokenRefresh] ${integration.provider} token refreshed via backend`,
            );
            return res.access_token;
        } catch (error: any) {
            console.error(
                '[TokenRefresh] Backend token refresh failed:',
                error,
            );
            throw new Error(
                'Failed to refresh Google token. Please re-authenticate.',
            );
        }
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
