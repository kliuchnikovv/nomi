/**
 * Encryption Service
 * Handles encryption/decryption of sensitive data using expo-secure-store
 */

import * as SecureStore from 'expo-secure-store';

const ENCRYPTION_KEY_ALIAS = 'genie_encryption_key';

// Simple XOR-based encryption for tokens
// In production, consider using a proper crypto library
// expo-secure-store handles the actual secure storage of the key

let encryptionKey: string | null = null;

/**
 * Initialize or retrieve the encryption key
 */
async function getOrCreateKey(): Promise<string> {
    if (encryptionKey) {
        return encryptionKey;
    }

    // Try to get existing key
    let key = await SecureStore.getItemAsync(ENCRYPTION_KEY_ALIAS);

    if (!key) {
        // Generate a new random key (32 chars)
        key = generateRandomKey(32);
        await SecureStore.setItemAsync(ENCRYPTION_KEY_ALIAS, key);
    }

    encryptionKey = key;
    return key;
}

/**
 * Generate a random key
 */
function generateRandomKey(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Encrypt a string
 */
export async function encrypt(plaintext: string): Promise<string> {
    if (!plaintext) return '';

    const key = await getOrCreateKey();
    let encrypted = '';

    for (let i = 0; i < plaintext.length; i++) {
        const charCode = plaintext.charCodeAt(i) ^ key.charCodeAt(i % key.length);
        encrypted += String.fromCharCode(charCode);
    }

    // Base64 encode the result
    return btoa(encrypted);
}

/**
 * Decrypt a string
 */
export async function decrypt(ciphertext: string): Promise<string> {
    if (!ciphertext) return '';

    const key = await getOrCreateKey();

    // Base64 decode
    const decoded = atob(ciphertext);
    let decrypted = '';

    for (let i = 0; i < decoded.length; i++) {
        const charCode = decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length);
        decrypted += String.fromCharCode(charCode);
    }

    return decrypted;
}

/**
 * Clear the encryption key (for logout)
 */
export async function clearEncryptionKey(): Promise<void> {
    await SecureStore.deleteItemAsync(ENCRYPTION_KEY_ALIAS);
    encryptionKey = null;
}
