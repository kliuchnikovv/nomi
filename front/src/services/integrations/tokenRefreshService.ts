/**
 * Token Refresh Service
 * Handles automatic token refresh before expiry using Client-Side SDKs where possible
 */

import { GoogleSignin } from '@react-native-google-signin/google-signin';
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
            // If we have no tokens but an integration exists, maybe we can try silent sign-in to recover?
            // This happens if the user cleared storage but is still logged in to Google System.
            try {
                return await this.forceRefresh(integrationId);
            } catch (e) {
                throw new Error('No credentials found for integration and recovery failed');
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
        const integration = await integrationStorage.getIntegration(integrationId);
        if (!integration) {
            throw new Error('Integration not found');
        }

        console.log(`[TokenRefresh] Refreshing token for ${integration.provider}...`);

        if (integration.provider === 'gmail' || integration.provider === 'calendar') {
            return this.refreshGoogleToken(integrationId);
        }

        // Add other providers here if needed...

        throw new Error(`Auto-refresh not supported for provider: ${integration.provider}`);
    }

    /**
     * Refresh Google Token using the Client SDK
     * This keeps the refresh logic purely on the client side (Local Hands).
     */
    private async refreshGoogleToken(integrationId: string): Promise<string> {
        try {
            // Ensure Play Services are available
            await GoogleSignin.hasPlayServices();

            // signInSilently() usually returns fresh tokens if the user is already signed in.
            // If fails, we might need clear cache or re-login.
            const userInfo = await GoogleSignin.signInSilently();
            const tokens = await GoogleSignin.getTokens();

            const newExpiry = Date.now() + 3500 * 1000; // Assume 1 hour usually, take a bit off

            await secureTokenStorage.saveToken(integrationId, {
                accessToken: tokens.accessToken,
                refreshToken: 'google-signin-managed',
                expiry: newExpiry,
            });

            // Sync with IntegrationStorage just in case legacy code reads it
            // (Though we should aim to remove this dependency)
            await integrationStorage.updateCredentials(integrationId, {
                accessToken: tokens.accessToken,
                tokenExpiry: new Date(newExpiry),
            });

            console.log(`[TokenRefresh] Google token refreshed locally via SDK`);
            return tokens.accessToken;

        } catch (error: any) {
            console.error('[TokenRefresh] Google silent sign-in failed:', error);

            // If strictly needed, we could fallback to backend refresh IF and ONLY IF we had a refresh token in the backend?
            // But per "Local Hands" architecture, we want to ABANDON backend refresh.
            // So we just throw error. User might need to re-login.
            throw new Error('Failed to refresh Google token locally. Please re-authenticate.');
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
