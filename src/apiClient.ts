import { API_URL } from './config';

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

    let response = await call(endpoint, customOptions);
    if (response.status === 401 && !endpoint.includes('/auth/')) {
        const refreshed = await authStore.refreshToken();
        if (refreshed) {
            response = await call(endpoint, customOptions);
        } else {
            authStore.logout();
        }
    }
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
    options.headers = headers;

    console.log(`token is ${newToken}`)
    const response = await fetch(endpoint, options);

    return response
}

export const apiClient = {
    get: <T>(endpoint: string, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'GET' }),
    post: <T>(endpoint: string, body: any, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'POST', body: JSON.stringify(body) }),
    put: <T>(endpoint: string, body: any, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'PUT', body: JSON.stringify(body) }),
    patch: <T>(endpoint: string, body?: any, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
    delete: <T>(endpoint: string, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'DELETE' }),
};

export const integrationsApi = {
    getIntegrations: () => apiClient.get<any[]>(`${API_URL}/integrations`),
    getTools: () => apiClient.get<any[]>(`${API_URL}/tools`),
    connectIntegration: (provider: string) => apiClient.post<{ auth_url: string }>(`${API_URL}/oauth/${provider}/login`, {}),
    deleteTool: (id: string) => apiClient.delete<void>(`${API_URL}/tools/${id}`),
    syncGmail: () => apiClient.post<{ status: string }>(`${API_URL}/integrations/gmail/sync`, {}),
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

export const modelsApi = {
    getModels: async () => {
        const response = await apiClient.get<{ models: any[] }>(`${API_URL}/models`);
        return response?.models || [];
    },
};
