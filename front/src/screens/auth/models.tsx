import { Alert } from 'react-native';

export type User = {
    id: string;
    name: string;
    email: string;
    single_chat_mode?: boolean;
    agent_storage_mode?: 'payload' | 'agno';
    updates_chat_id?: string | null;
    proactive_enabled?: boolean;
    /** IANA timezone, e.g. "Europe/Moscow". */
    timezone?: string | null;
    /** Local "HH:MM" for the scheduled daily brief; null/absent = disabled. */
    daily_brief_time?: string | null;
};

export interface AuthContextType {
    user: User | null;
    token: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;

    // Methods
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, password: string, name: string) => Promise<void>;
    logout: () => Promise<void>;
    refreshToken: () => Promise<boolean>;
    signInWithGoogle: () => Promise<void>;
    updateUser: (user: User) => Promise<void>;
}

export function alertError(message: string) {
    try {
        Alert.alert('Error', message);
    } catch (error) {
        console.error(error);
    }
}
