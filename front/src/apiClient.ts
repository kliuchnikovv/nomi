import { getApiUrl } from './config';
import {
    SidebarChatsResponse,
    SidebarChatMessagesResponse,
    SidebarResponse,
} from './screens/integrationsSidebar/models';

// Helper to get current API URL (reads from cache, falls back to default)
const API_URL = () => getApiUrl();

// Stable module-level token — never wrapped in a stale React closure.
// Set by setupApiClient on every auth state change, and by setAuthToken
// from background tasks (which run outside the React lifecycle).
let _token: string | null = null;

export const authStore = {
    getToken: (): string | null => _token,
    refreshToken: (): Promise<boolean> => Promise.resolve(false),
    logout: (): void => {},
};

/**
 * Set the auth token directly. Used by background tasks that run outside
 * the React lifecycle, where the AuthProvider closure is not yet active.
 */
export function setAuthToken(token: string | null): void {
    _token = token;
}

/**
 * Initialization function. Will be called once from AuthContext.
 */
export function setupApiClient(authFunctions: {
    getToken: () => string | null;
    refreshToken: () => Promise<boolean>;
    logout: () => void;
}) {
    _token = authFunctions.getToken();
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
            message =
                (asJson && (asJson.message || asJson.error || asJson.detail)) ||
                message;
        } catch {
            try {
                const asText = await response.text();
                message = asText || message;
            } catch {
                /* ignore */
            }
        }
        console.log(`call error`, response.status, message);
        throw new Error(message);
    }

    return (await response.json()) as Promise<T>;
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
            response = await fetch(endpoint, {
                ...requestOptions,
                headers: retryHeaders,
            });
        } else {
            authStore.logout();
        }
    }

    return response;
}

async function startOAuthLogin(provider: string): Promise<string> {
    const response = await apiClient.post<{ auth_url: string }>(
        `${API_URL()}/oauth/${provider}/login`,
        {},
    );
    if (response?.auth_url) {
        return response.auth_url;
    }
    throw new Error('No auth_url returned from OAuth login');
}

/** Send client tool execution result for round-trip proxy (model -> device -> result). */
export async function sendClientToolResult(
    sessionId: string,
    callId: string,
    result: string,
): Promise<void> {
    await apiClient.post<{ ok?: boolean }>(
        `${API_URL()}/chat/client-tool-result`,
        {
            session_id: sessionId,
            call_id: callId,
            result,
        },
    );
}

/** A queued client action awaiting execution on this device. */
export interface PendingAction {
    call_id: string;
    session_id: string;
    tool: string;
    method: string;
    params: Record<string, any>;
    integration_id?: string;
}

/** Fetch client actions queued for this device (offline outbox drain). */
export async function fetchPendingActions(): Promise<PendingAction[]> {
    const resp = await apiClient.get<{ actions?: PendingAction[] }>(
        `${API_URL()}/pending-actions`,
    );
    return resp?.actions ?? [];
}

/** Report the result of a drained queued action. */
export async function sendPendingActionResult(
    callId: string,
    result: string,
): Promise<void> {
    await apiClient.post<{ ok?: boolean }>(
        `${API_URL()}/pending-actions/result`,
        { call_id: callId, result },
    );
}

export const apiClient = {
    get: <T>(endpoint: string, options?: RequestInit) =>
        request<T>(endpoint, { ...options, method: 'GET' }),
    post: <T>(endpoint: string, body: any, options?: RequestInit) =>
        request<T>(endpoint, {
            ...options,
            method: 'POST',
            body: JSON.stringify(body),
        }),
    put: <T>(endpoint: string, body: any, options?: RequestInit) =>
        request<T>(endpoint, {
            ...options,
            method: 'PUT',
            body: JSON.stringify(body),
        }),
    patch: <T>(endpoint: string, body?: any, options?: RequestInit) =>
        request<T>(endpoint, {
            ...options,
            method: 'PATCH',
            body: body ? JSON.stringify(body) : undefined,
        }),
    delete: <T>(endpoint: string, options?: RequestInit) =>
        request<T>(endpoint, { ...options, method: 'DELETE' }),
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
                Authorization: `Bearer ${authStore.getToken()}`,
            },
        });

        if (!response.ok) {
            throw new Error('File upload failed');
        }

        return await response.json();
    },
};

export const pluginsApi = {
    list: () =>
        apiClient.get<
            Array<{
                name: string;
                info?: Record<string, any>;
                state?: Record<string, any>;
                enabled: boolean;
                provider?: string;
                integration_id?: string;
                id?: string;
                params?: Record<string, any>;
            }>
        >(`${API_URL()}/plugins`),
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
    getPluginState: (name: string) =>
        apiClient.get<{ enabled: boolean; state: Record<string, any> }>(
            `${API_URL()}/plugins/${name}/state`,
        ),
    updatePluginState: (name: string, state: Record<string, any>) =>
        apiClient.put<void>(`${API_URL()}/plugins/${name}/state`, state),
    startOAuthLogin,
};

export const integrationsApi = {
    list: () =>
        apiClient.get<
            | {
                  items?: Array<{
                      id: string;
                      name: string;
                      provider: string;
                      enabled: boolean;
                      state?: Record<string, any>;
                      params?: Record<string, any>;
                      info?: Record<string, any>;
                  }>;
              }
            | Array<{
                  id: string;
                  name: string;
                  provider: string;
                  enabled: boolean;
                  state?: Record<string, any>;
                  params?: Record<string, any>;
                  info?: Record<string, any>;
              }>
        >(`${API_URL()}/integrations`),
    update: (id: string, body: { name?: string; enabled?: boolean }) =>
        apiClient.patch<void>(`${API_URL()}/integrations/${id}`, body),
    delete: (id: string) =>
        apiClient.delete<void>(`${API_URL()}/integrations/${id}`),
    // Store IMAP/SMTP credentials server-side so the brain can run email tools
    // without the device (creds are encrypted at rest by the API).
    storeImapCredentials: (body: {
        account_email: string;
        display_name?: string;
        username: string;
        password: string;
        imap_host: string;
        imap_port: number;
        imap_use_tls: boolean;
        smtp_host: string;
        smtp_port: number;
        smtp_use_tls: boolean;
    }) =>
        apiClient.post<{ status: string; account_email: string }>(
            `${API_URL()}/integrations/imap/credentials`,
            body,
        ),
};

export const inboxApi = {
    getInbox: ({
        page = 1,
        limit = 20,
        provider,
        integrationId,
    }: {
        page?: number;
        limit?: number;
        provider?: string;
        integrationId?: string;
    }) => {
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
    executeAction: (
        messageId: string,
        action: {
            command: string;
            agent?: string;
            url?: string;
            prompt?: string;
        },
    ) =>
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
            `${API_URL()}/sidebar/${provider}/chats${
                integrationId ? `?integration_id=${integrationId}` : ''
            }`,
        ),
    getChatMessages: (
        provider: string,
        chatId: string | number,
        integrationId?: string,
    ) =>
        apiClient.get<SidebarChatMessagesResponse>(
            `${API_URL()}/sidebar/${provider}/chats/${chatId}${
                integrationId ? `?integration_id=${integrationId}` : ''
            }`,
        ),
    sendChatMessage: (provider: string, chatId: string | number, body: any) =>
        apiClient.post(
            `${API_URL()}/sidebar/${provider}/chats/${chatId}/messages`,
            body,
        ),
    executeMessageAction: (provider: string, messageId: string, body: any) =>
        apiClient.post(
            `${API_URL()}/sidebar/${provider}/messages/${messageId}/actions`,
            body,
        ),
};

export const modelsApi = {
    getModels: async () => {
        const response = await apiClient.get<{ models: any[] }>(
            `${API_URL()}/models`,
        );
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

export const chatsApi = {
    getPersistentChat: () =>
        apiClient.get<import('./screens/main/models').Chat>(
            `${API_URL()}/chats/persistent`,
        ),
    getPersistentChats: () =>
        apiClient.get<import('./screens/main/models').Chat[]>(
            `${API_URL()}/chats/persistent/all`,
        ),
    getMessages: (chatId: string) =>
        apiClient.get<import('./screens/main/models').Message[]>(
            `${API_URL()}/chats/${chatId}/messages`,
        ),
};

export const projectsApi = {
    list: () =>
        apiClient.get<import('./screens/main/models').Project[]>(
            `${API_URL()}/projects`,
        ),
    create: (body: { name: string; description?: string; icon?: string }) =>
        apiClient.post<import('./screens/main/models').Project>(
            `${API_URL()}/projects`,
            body,
        ),
    update: (
        id: string,
        body: { name: string; description?: string; icon?: string },
    ) =>
        apiClient.put<import('./screens/main/models').Project>(
            `${API_URL()}/projects/${id}`,
            body,
        ),
    delete: (id: string) =>
        apiClient.delete<void>(`${API_URL()}/projects/${id}`),
};

export const briefingApi = {
    getBriefing: (context?: any) =>
        apiClient.post<any>(`${API_URL()}/briefing`, { context }),
    analyze: (text: string) =>
        apiClient.post<{ events: any[]; tasks: any[] }>(
            `${API_URL()}/analyze`,
            { text },
        ),
};

export const weatherApi = {
    getCurrentWeather: async (lat: number, lon: number) => {
        const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`,
        );
        return response.json();
    },
};

export const ragApi = {
    index: (doc: {
        id: string;
        source_type: string;
        content: string;
        metadata?: Record<string, any>;
    }) => apiClient.post<{ ok: boolean }>(`${API_URL()}/rag/index`, doc),
};

export const eventsApi = {
    async ingest(payload: {
        source: 'calendar' | 'email' | 'reminders' | 'health';
        event_type:
            | 'calendar_upcoming'
            | 'email_new'
            | 'reminder_due'
            | 'health_anomaly';
        payload: Record<string, unknown>;
        fire_at?: string;
    }): Promise<{ id: string; state: string }> {
        const result = await apiClient.post<{ id: string; state: string }>(
            `${API_URL()}/events/ingest`,
            payload,
        );
        if (!result) {
            throw new Error('Empty response from events/ingest');
        }
        return result;
    },

    // TODO(backend): POST /api/events/{eventId}/state requires a small Go-side addition
    // (handler in api/internal/handlers/events.go + route registration). The endpoint is
    // called correctly here; once the Go PR lands it will start returning 200 instead of 404.
    async setState(
        eventId: string,
        state: 'dismissed' | 'discussed',
    ): Promise<void> {
        await apiClient.post<void>(`${API_URL()}/events/${eventId}/state`, {
            state,
        });
    },
};

export interface BotIdentity {
    user_id?: string;
    name: string;
    instructions: string;
    tone: 'formal' | 'casual' | 'playful';
}

export const botIdentityApi = {
    get: () => apiClient.get<BotIdentity>(`${API_URL()}/user/bot-identity`),
    update: (body: Omit<BotIdentity, 'user_id'>) =>
        apiClient.put<BotIdentity>(`${API_URL()}/user/bot-identity`, body),
};

export const emailApi = {
    analyze: (email: {
        subject: string;
        snippet: string;
        from_email: string;
        from_name: string;
        labels: string[];
    }) =>
        apiClient.post<{
            is_important: boolean;
            urgent: boolean;
            priority: number;
            action_hint: string;
            due_date_iso: string;
        }>(`${API_URL()}/emails/analyze`, email),
};

export interface MemoryEntry {
    id: string;
    memory: string;
    created_at: string;
    updated_at: string;
}

export const memoryApi = {
    list: () => apiClient.get<MemoryEntry[]>(`${API_URL()}/user/memories`),
    delete: (id: string) =>
        apiClient.delete<void>(`${API_URL()}/user/memories/${id}`),
};

export interface EntityFact {
    id: string;
    content: string;
    confidence?: number;
}

export interface EntityEvent {
    id: string;
    content: string;
    date?: string;
}

export interface EntityRelationship {
    entity_id: string;
    relation: string;
}

export interface EntityEntry {
    id: string;
    entity_id: string;
    entity_type: string;
    name?: string;
    description?: string;
    properties?: Record<string, string>;
    facts?: EntityFact[];
    events?: EntityEvent[];
    relationships?: EntityRelationship[];
    created_at: string;
    updated_at: string;
}

export const entityApi = {
    list: () => apiClient.get<EntityEntry[]>(`${API_URL()}/user/entities`),
};

export const credentialsApi = {
    save: (
        provider: string,
        type: 'api_key' | 'custom',
        apiKey?: string,
        extra?: Record<string, any>,
    ) =>
        apiClient.post<{ ok: boolean }>(`${API_URL()}/credentials`, {
            provider,
            type,
            api_key: apiKey,
            extra,
        }),
    list: () =>
        apiClient.get<{ providers: string[] }>(`${API_URL()}/credentials`),
    check: (provider: string) =>
        apiClient.get<{ exists: boolean }>(
            `${API_URL()}/credentials/${provider}/check`,
        ),
    delete: (provider: string) =>
        apiClient.delete<{ ok: boolean }>(
            `${API_URL()}/credentials/${provider}`,
        ),
    request: (providers: string[]) =>
        apiClient.post<{
            ok: boolean;
            missing?: string[];
            requires_input?: boolean;
        }>(`${API_URL()}/credentials/request`, { providers }),
};
