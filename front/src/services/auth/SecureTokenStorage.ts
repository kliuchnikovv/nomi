import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY_PREFIX = 'integration_token_';

// AFTER_FIRST_UNLOCK allows background tasks to read tokens even when the
// screen is locked, as long as the device has been unlocked at least once
// since boot. Required for background fetch / background task execution.
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export const secureTokenStorage = {
    /**
     * Save OAuth tokens for an integration
     */
    async saveToken(integrationId: string, tokens: { accessToken: string; refreshToken: string; expiry: number }) {
        const key = `${TOKEN_KEY_PREFIX}${integrationId}`;
        await SecureStore.setItemAsync(key, JSON.stringify(tokens), KEYCHAIN_OPTIONS);
    },

    /**
     * Get OAuth tokens for an integration
     */
    async getToken(integrationId: string): Promise<{ accessToken: string; refreshToken: string; expiry: number } | null> {
        const key = `${TOKEN_KEY_PREFIX}${integrationId}`;
        const data = await SecureStore.getItemAsync(key);
        if (!data) return null;
        try {
            return JSON.parse(data);
        } catch (e) {
            console.error('Failed to parse token from secure store', e);
            return null;
        }
    },

    /**
     * Delete tokens for an integration
     */
    async deleteToken(integrationId: string) {
        const key = `${TOKEN_KEY_PREFIX}${integrationId}`;
        await SecureStore.deleteItemAsync(key);
    },
};
