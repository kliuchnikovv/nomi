import { Alert } from 'react-native';

export type User = {
    id: string;
    name: string;
    email: string;
    single_chat_mode?: boolean;
}

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

