import AsyncStorage from '@react-native-async-storage/async-storage';

// Centralized app configuration
const DEFAULT_API_URL = 'https://genie-api-production-7074.up.railway.app/api';
const API_URL_KEY = '@genie_api_url';

// In-memory cache for sync access
let cachedApiUrl: string | null = null;

// Initialize cache from storage
export async function initApiUrl(): Promise<string> {
    try {
        const stored = await AsyncStorage.getItem(API_URL_KEY);
        cachedApiUrl = stored || DEFAULT_API_URL;
        return cachedApiUrl;
    } catch {
        cachedApiUrl = DEFAULT_API_URL;
        return cachedApiUrl;
    }
}

// Sync getter (use cached value)
export function getApiUrl(): string {
    return cachedApiUrl || DEFAULT_API_URL;
}

// Async setter
export async function setApiUrl(url: string): Promise<void> {
    cachedApiUrl = url;
    await AsyncStorage.setItem(API_URL_KEY, url);
}

// Legacy export for compatibility (use getApiUrl() for new code)
export const API_URL = DEFAULT_API_URL;

// Deep link scheme for OAuth callback (make sure it's configured in iOS/Android)
export const APP_SCHEME = 'genie';
export const OAUTH_CALLBACK_URL = `${APP_SCHEME}://oauth/callback`;

//'http://localhost:8080/api'
