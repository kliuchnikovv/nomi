/**
 * Authentication and user types
 */

export interface User {
    id: string;
    email: string;
    name?: string;
    picture?: string;
    provider: string;
    provider_id: string;
    created_at: string;
    updated_at: string;
}

export interface AuthContextType {
    user: User | null;
    token: string | null;
    refreshToken: string | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    refresh: () => Promise<void>;
    googleSignIn: () => Promise<void>;
}