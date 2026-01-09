import { getApiUrl } from './config';
import { SidebarChatsResponse, SidebarChatMessagesResponse, SidebarResponse } from './screens/rightsidebar/models';

// Helper to get current API URL (reads from cache, falls back to default)
const API_URL = () => getApiUrl();

// Хранилище для функций из AuthContext. Изначально пустое.
export const authStore = {
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
    const response = await apiClient.post<{ auth_url: string }>(`${API_URL()}/oauth/${provider}/login`, {});
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
    uploadFile: async (file: { uri: string; name: string; type: string }) => {
        const formData = new FormData();
        formData.append('file', {
            uri: file.uri,
            name: file.name,
            type: file.type,
        } as any);

        const response = await fetch(`${API_URL()}/upload`, {
            method: 'POST',
            body: formData,
            headers: {
                'Content-Type': 'multipart/form-data',
                'Authorization': `Bearer ${authStore.getToken()}`,
            },
        });

        if (!response.ok) {
            throw new Error('File upload failed');
        }

        return await response.json();
    },
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
    }>>(`${API_URL()}/plugins`),
    enablePlugin: (name: string, integrationId?: string) =>
        apiClient.post<void>(
            `${API_URL()}/plugins/${name}/enable`,
            integrationId ? { integration_id: integrationId } : {},
        ),
    disablePlugin: (name: string, integrationId?: string) =>
        apiClient.post<void>(
            `${API_URL()}/plugins/${name}/disable`,
            integrationId ? { integration_id: integrationId } : {},
        ),
    getPluginState: (name: string) => apiClient.get<{ enabled: boolean; state: Record<string, any> }>(`${API_URL()}/plugins/${name}/state`),
    updatePluginState: (name: string, state: Record<string, any>) => apiClient.put<void>(`${API_URL()}/plugins/${name}/state`, state),
    startOAuthLogin,
    syncGmail: () => apiClient.post<{ message: string }>(`${API_URL()}/plugins/gmail/sync`, {}),
    syncImap: (config: { host: string; username: string; password: string }) =>
        apiClient.post<{ status: string }>(`${API_URL()}/plugins/imap/sync`, config),
    connectJules: (apiKey: string) =>
        apiClient.post<{ status: string; id: string }>(`${API_URL()}/plugins/jules/connect`, { api_key: apiKey }),
    syncJules: () =>
        apiClient.post<{ status: string; synced: number; errors: string[] }>(`${API_URL()}/plugins/jules/sync`, {}),
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
    }>>(`${API_URL()}/integrations`),
    update: (id: string, body: { name?: string; enabled?: boolean }) =>
        apiClient.patch<void>(`${API_URL()}/integrations/${id}`, body),
    delete: (id: string) => apiClient.delete<void>(`${API_URL()}/integrations/${id}`),
};

export const inboxApi = {
    getInbox: ({ page = 1, limit = 20, provider, integrationId }: { page?: number; limit?: number; provider?: string; integrationId?: string }) => {
        const params = new URLSearchParams();
        params.append('page', String(page));
        params.append('limit', String(limit));
        if (provider) params.append('provider', provider);
        if (integrationId) params.append('integration_id', integrationId);
        return apiClient.get<any>(`${API_URL()}/inbox?${params.toString()}`);
    },
    getInboxMessage: (id: string) =>
        apiClient.get<any>(`${API_URL()}/inbox/${id}`),
    markAsRead: (id: string) =>
        apiClient.patch<void>(`${API_URL()}/inbox/${id}/read`),
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
        }>(`${API_URL()}/inbox/${messageId}/actions`, action),
};

export const sidebarApi = {
    getSidebar: () => apiClient.get<SidebarResponse>(`${API_URL()}/sidebar`),
    getChats: (provider: string, integrationId?: string) =>
        apiClient.get<SidebarChatsResponse>(
            `${API_URL()}/sidebar/${provider}/chats${integrationId ? `?integration_id=${integrationId}` : ''}`,
        ),
    getChatMessages: (provider: string, chatId: string | number, integrationId?: string) =>
        apiClient.get<SidebarChatMessagesResponse>(
            `${API_URL()}/sidebar/${provider}/chats/${chatId}${integrationId ? `?integration_id=${integrationId}` : ''}`,
        ),
    sendChatMessage: (provider: string, chatId: string | number, body: any) =>
        apiClient.post(`${API_URL()}/sidebar/${provider}/chats/${chatId}/messages`, body),
    executeMessageAction: (provider: string, messageId: string, body: any) =>
        apiClient.post(`${API_URL()}/sidebar/${provider}/messages/${messageId}/actions`, body),
};

export const modelsApi = {
    getModels: async () => {
        const response = await apiClient.get<{ models: any[] }>(`${API_URL()}/models`);
        return response?.models || [];
    },
};

export const pluginChatsApi = {
    deleteChat: (chatId: string | number) =>
        apiClient.delete<void>(`${API_URL()}/plugin_chats/${chatId}`),
};

export const authApi = {
    getMe: () => apiClient.get<any>(`${API_URL()}/auth/me`),
    updateMe: (body: any) => apiClient.put<any>(`${API_URL()}/auth/me`, body),
};

export const briefingApi = {
    getBriefing: (context?: any) =>
        apiClient.post<any>(`${API_URL()}/briefing`, { context }),
    analyze: (text: string) =>
        apiClient.post<{ events: any[]; tasks: any[] }>(`${API_URL()}/analyze`, { text }),
};

export const dashboardApi = {
    getDashboard: () => apiClient.get<{
        user: { name: string };
        recent_chats: Array<any>;
        stats: { unread_emails: number; today_events: number };
    }>(`${API_URL()}/dashboard`),
};

export const weatherApi = {
    getCurrentWeather: async (lat: number, lon: number) => {
        const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
        );
        return response.json();
    },
};

export interface Project {
    ID: string;
    UserID: string;
    Name: string;
    Description?: string;
    Repository?: string;
    Status: 'PENDING' | 'ANALYZING' | 'READY' | 'FAILED';
    LastIndexedAt?: string;
    CreatedAt: string;
    UpdatedAt: string;
}

export const projectsApi = {
    listRepositories: (githubToken?: string) => apiClient.post<{ repos: Array<{ id: number; name: string; url: string; private: boolean; description?: string }> }>(`${API_URL()}/github/repos`, { github_token: githubToken }),
    list: () => apiClient.get<Array<Project>>(`${API_URL()}/projects`),
    get: (id: string) => apiClient.get<Project>(`${API_URL()}/projects/${id}`),
    create: (body: { name: string; description?: string; repository?: string; github_token?: string }) =>
        apiClient.post<Project>(`${API_URL()}/projects`, body),
    update: (id: string, body: { name?: string; description?: string; repository?: string }) =>
        apiClient.put<Project>(`${API_URL()}/projects/${id}`, body),
    delete: (id: string) => apiClient.delete<void>(`${API_URL()}/projects/${id}`),
    updateStatus: (id: string, status: Project['Status']) =>
        apiClient.patch<void>(`${API_URL()}/projects/${id}/status`, { status }),
};

