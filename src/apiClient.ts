import { API_URL } from './config';
import { SidebarChatsResponse, SidebarChatMessagesResponse, SidebarResponse } from './screens/rightsidebar/models';

// Хранилище для функций из AuthContext. Изначально пустое.
const authStore = {
    getToken: (): string | null => null,
    refreshToken: (): Promise<boolean> => Promise.resolve(false),
    logout: (): void => { },
};

/**
 * Функция для инициализации. Будет вызвана один раз из AuthContext.
 */
export function setupApiClient(authFunctions: {
    getToken: () => string | null;
    refreshToken: () => Promise<boolean>;
    logout: () => void;
}) {
    authStore.getToken = authFunctions.getToken;
    authStore.refreshToken = authFunctions.refreshToken;
    authStore.logout = authFunctions.logout;
}

async function request<T>(
    endpoint: string,
    options: RequestInit = {},
): Promise<T | null> {
    const customOptions: RequestInit = {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    };

    const response = await call(endpoint, customOptions);
    if (response.status === 204) {
        return null;
    }

    if (!response.ok) {
        let message = 'Something went wrong';
        try {
            const asJson = await response.clone().json();
            message = (asJson && (asJson.message || asJson.error || asJson.detail)) || message;
        } catch {
            try {
                const asText = await response.text();
                message = asText || message;
            } catch { /* ignore */ }
        }
        console.log(`call error`, response.status, message);
        throw new Error(message);
    }

    return await response.json() as Promise<T>;
}

async function call(endpoint: string, options: RequestInit = {}) {
    const newToken = authStore.getToken();
    // Normalize headers to a plain object to allow mutation
    const headers: Record<string, string> = {
        ...(options.headers as Record<string, string> | undefined),
    };
    if (newToken) {
        headers.Authorization = `Bearer ${newToken}`;
    }
    const requestOptions: RequestInit = { ...options, headers };
    let response = await fetch(endpoint, requestOptions);
    if (response.status === 401 && !endpoint.includes('/auth/')) {
        const refreshed = await authStore.refreshToken();
        if (refreshed) {
            const retryToken = authStore.getToken();
            const retryHeaders = { ...headers };
            if (retryToken) {
                retryHeaders.Authorization = `Bearer ${retryToken}`;
            }
            response = await fetch(endpoint, { ...requestOptions, headers: retryHeaders });
        } else {
            authStore.logout();
        }
    }

    return response
}

async function startOAuthLogin(provider: string): Promise<string> {
    const response = await apiClient.post<{ auth_url: string }>(`${API_URL}/oauth/${provider}/login`, {});
    if (response?.auth_url) {
        return response.auth_url;
    }
    throw new Error('No auth_url returned from OAuth login');
}

export const apiClient = {
    get: <T>(endpoint: string, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'GET' }),
    post: <T>(endpoint: string, body: any, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'POST', body: JSON.stringify(body) }),
    put: <T>(endpoint: string, body: any, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'PUT', body: JSON.stringify(body) }),
    patch: <T>(endpoint: string, body?: any, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
    delete: <T>(endpoint: string, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'DELETE' }),
};

export const pluginsApi = {
    list: () => apiClient.get<Array<{
        name: string;
        info?: Record<string, any>;
        state?: Record<string, any>;
        enabled: boolean;
        provider?: string;
        integration_id?: string;
        id?: string;
        params?: Record<string, any>;
    }>>(`${API_URL}/plugins`),
    enablePlugin: (name: string, integrationId?: string) =>
        apiClient.post<void>(
            `${API_URL}/plugins/${name}/enable`,
            integrationId ? { integration_id: integrationId } : {},
        ),
    disablePlugin: (name: string, integrationId?: string) =>
        apiClient.post<void>(
            `${API_URL}/plugins/${name}/disable`,
            integrationId ? { integration_id: integrationId } : {},
        ),
    getPluginState: (name: string) => apiClient.get<{ enabled: boolean; state: Record<string, any> }>(`${API_URL}/plugins/${name}/state`),
    updatePluginState: (name: string, state: Record<string, any>) => apiClient.put<void>(`${API_URL}/plugins/${name}/state`, state),
    startOAuthLogin,
    syncGmail: () => apiClient.post<{ message: string }>(`${API_URL}/plugins/gmail/sync`, {}),
    syncImap: (config: { host: string; username: string; password: string }) =>
        apiClient.post<{ status: string }>(`${API_URL}/plugins/imap/sync`, config),
};

export const integrationsApi = {
    list: () => apiClient.get<{
        items?: Array<{
            id: string;
            name: string;
            provider: string;
            enabled: boolean;
            state?: Record<string, any>;
            params?: Record<string, any>;
            info?: Record<string, any>;
        }>;
    } | Array<{
        id: string;
        name: string;
        provider: string;
        enabled: boolean;
        state?: Record<string, any>;
        params?: Record<string, any>;
        info?: Record<string, any>;
    }>>(`${API_URL}/integrations`),
    update: (id: string, body: { name?: string; enabled?: boolean }) =>
        apiClient.patch<void>(`${API_URL}/integrations/${id}`, body),
    delete: (id: string) => apiClient.delete<void>(`${API_URL}/integrations/${id}`),
};

export const inboxApi = {
    getInbox: (page: number = 1, limit: number = 20) =>
        apiClient.get<any>(`${API_URL}/inbox?page=${page}&limit=${limit}`),
    getInboxMessage: (id: string) =>
        apiClient.get<any>(`${API_URL}/inbox/${id}`),
    markAsRead: (id: string) =>
        apiClient.patch<void>(`${API_URL}/inbox/${id}/read`),
    executeAction: (messageId: string, action: {
        command: string;
        agent?: string;
        url?: string;
        prompt?: string;
    }) =>
        apiClient.post<{
            success: boolean;
            message: string;
            result?: string;
        }>(`${API_URL}/inbox/${messageId}/actions`, action),
};

export const sidebarApi = {
    getSidebar: () => apiClient.get<SidebarResponse>(`${API_URL}/sidebar`),
    getChats: (provider: string, integrationId?: string) =>
        apiClient.get<SidebarChatsResponse>(
            `${API_URL}/sidebar/${provider}/chats${integrationId ? `?integration_id=${integrationId}` : ''}`,
        ),
    getChatMessages: (provider: string, chatId: string | number, integrationId?: string) =>
        apiClient.get<SidebarChatMessagesResponse>(
            `${API_URL}/sidebar/${provider}/chats/${chatId}${integrationId ? `?integration_id=${integrationId}` : ''}`,
        ),
    sendChatMessage: (provider: string, chatId: string | number, body: any) =>
        apiClient.post(`${API_URL}/sidebar/${provider}/chats/${chatId}/messages`, body),
    executeMessageAction: (provider: string, messageId: string, body: any) =>
        apiClient.post(`${API_URL}/sidebar/${provider}/messages/${messageId}/actions`, body),
};

export const modelsApi = {
    getModels: async () => {
        const response = await apiClient.get<{ models: any[] }>(`${API_URL}/models`);
        return response?.models || [];
    },
};

export const pluginChatsApi = {
    renameChat: (chatId: string | number, title: string) =>
        apiClient.patch<void>(`${API_URL}/plugin_chats/${chatId}`, { title }),
    deleteChat: (chatId: string | number) =>
        apiClient.delete<void>(`${API_URL}/plugin_chats/${chatId}`),
};
