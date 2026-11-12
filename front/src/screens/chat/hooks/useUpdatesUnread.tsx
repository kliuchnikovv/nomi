/**
 * useUpdatesUnread / UpdatesProvider — tracks the number of unseen proactive
 * messages in the user's Updates chat (chat_type='updates').
 *
 * Source of truth (client-side, Approach A): a `lastSeenUpdatesAt` timestamp
 * persisted in AsyncStorage. Unread = proactive messages with created_at newer
 * than that mark. This keeps the feature frontend-only (no backend last_read).
 * The count source is isolated here so a future move to a backend endpoint is a
 * single-file swap.
 */

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    ReactNode,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMain } from '../../main/context';
import { useAuth } from '../../auth/context.tsx';
import { chatsApi } from '../../../apiClient';

const LAST_SEEN_KEY = '@nomi_updates_last_seen';
const POLL_INTERVAL_MS = 60_000;

interface UpdatesContextType {
    /** Count of proactive messages newer than the last time the user opened the Updates chat. */
    unreadCount: number;
    /** Mark the Updates chat as seen now; zeroes the count and persists the mark. */
    markUpdatesSeen: () => void;
    /** Force an immediate re-fetch + recount. */
    refresh: () => void;
}

const UpdatesContext = createContext<UpdatesContextType | undefined>(undefined);

/** Safe zero-state used when consumed outside an UpdatesProvider (e.g. tests). */
const NO_UPDATES: UpdatesContextType = {
    unreadCount: 0,
    markUpdatesSeen: () => {},
    refresh: () => {},
};

export function useUpdates() {
    // The bell/banner are non-critical UI; degrade gracefully rather than crash
    // the host screen if rendered without the provider.
    return useContext(UpdatesContext) ?? NO_UPDATES;
}

/** Normalize a created_at value (epoch ms number, or ISO string) to epoch ms. */
const toMillis = (value?: number | string | null): number => {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
};

export function UpdatesProvider({ children }: { children: ReactNode }) {
    const { updatesChatId } = useMain();
    const { isAuthenticated } = useAuth();
    const [unreadCount, setUnreadCount] = useState(0);
    const lastSeenRef = useRef(0);

    // Load persisted lastSeen on mount.
    useEffect(() => {
        AsyncStorage.getItem(LAST_SEEN_KEY)
            .then(v => {
                const n = v ? Number(v) : 0;
                lastSeenRef.current = Number.isNaN(n) ? 0 : n;
            })
            .catch(() => {});
    }, []);

    const fetchAndCount = useCallback(async () => {
        if (!isAuthenticated || !updatesChatId) {
            setUnreadCount(0);
            return;
        }
        try {
            const messages = await chatsApi.getMessages(updatesChatId);
            if (!messages) {
                setUnreadCount(0);
                return;
            }
            const count = messages.filter(
                m =>
                    m.meta?.source === 'proactive' &&
                    toMillis(m.created_at) > lastSeenRef.current,
            ).length;
            setUnreadCount(count);
        } catch (e) {
            console.warn('[useUpdatesUnread] fetch failed:', e);
        }
    }, [isAuthenticated, updatesChatId]);

    const markUpdatesSeen = useCallback(() => {
        const now = Date.now();
        lastSeenRef.current = now;
        setUnreadCount(0);
        AsyncStorage.setItem(LAST_SEEN_KEY, String(now)).catch(() => {});
    }, []);

    // Fetch on mount and whenever auth / updatesChatId changes.
    useEffect(() => {
        fetchAndCount();
    }, [fetchAndCount]);

    // Poll on interval + re-fetch when the app returns to the foreground.
    useEffect(() => {
        if (!isAuthenticated || !updatesChatId) return;
        const interval = setInterval(fetchAndCount, POLL_INTERVAL_MS);
        const sub = AppState.addEventListener(
            'change',
            (state: AppStateStatus) => {
                if (state === 'active') fetchAndCount();
            },
        );
        return () => {
            clearInterval(interval);
            sub.remove();
        };
    }, [isAuthenticated, updatesChatId, fetchAndCount]);

    return (
        <UpdatesContext.Provider
            value={{ unreadCount, markUpdatesSeen, refresh: fetchAndCount }}
        >
            {children}
        </UpdatesContext.Provider>
    );
}
