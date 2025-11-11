// src/apiClient.ts

// Хранилище для функций из AuthContext. Изначально пустое.
const authStore = {
    getToken: (): string | null => null,
    refreshToken: (): Promise<boolean> => Promise.resolve(false),
    logout: (): void => {},
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
): Promise<T> {
    const customOptions: RequestInit = {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    };

    let response = await call(endpoint, customOptions);
    if (response.status === 401) {
        const refreshed = await authStore.refreshToken();
        if (refreshed) {
            response = await call(endpoint, customOptions);
        } else {
            authStore.logout();
        }
    }

    if (!response.ok) {
        const error = await response.json();
        console.log(`call error`, response);
        throw new Error(error.message || 'Something went wrong');
    }

    return await response.json() as Promise<T>;
}

async function call(endpoint: string, options: RequestInit = {}) {
    const newToken = authStore.getToken();
    if (newToken) {
        (options.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
    }

    console.log(`token is ${newToken}`)
    const response = await fetch(endpoint, options);

    return response
}

export const apiClient = {
    get: <T>(endpoint: string, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'GET' }),
    post: <T>(endpoint: string, body: any, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'POST', body: JSON.stringify(body) }),
    put: <T>(endpoint: string, body: any, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'PUT', body: JSON.stringify(body) }),
    delete: <T>(endpoint: string, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'DELETE' }),
};
