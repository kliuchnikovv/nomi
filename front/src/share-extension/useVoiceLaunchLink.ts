import { useEffect, useCallback, useRef } from 'react';
import { Linking } from 'react-native';
import type { NavigationContainerRef } from '@react-navigation/native';
import { useAuth } from '../screens/auth/context';
import { emptyChatID } from '../screens/main/context';
import { handleDeepLink } from '../services/notifications/deepLinkRouter';

// Deep link fired by the iOS Action Button App Intent ("Talk to Nomi").
// Opening `nomi://voice` lands the user directly in the voice conversation screen.
const VOICE_URL_PREFIX = 'nomi://voice';

export function useVoiceLaunchLink(
    navigationRef: React.RefObject<NavigationContainerRef<any> | null>,
) {
    const { isAuthenticated } = useAuth();
    // Set when a launch arrives before navigation/auth is ready (cold start,
    // or pressed while logged out). Flushed once both are available.
    const pendingRef = useRef(false);

    const route = useCallback(() => {
        const nav = navigationRef.current;
        if (!nav || !isAuthenticated) {
            pendingRef.current = true;
            return;
        }
        handleDeepLink(
            { screen: 'voice', params: { chatId: emptyChatID } },
            nav,
        );
    }, [navigationRef, isAuthenticated]);

    const handle = useCallback(
        (url: string | null) => {
            if (!url || !url.startsWith(VOICE_URL_PREFIX)) return;
            route();
        },
        [route],
    );

    useEffect(() => {
        const sub = Linking.addEventListener('url', ({ url }) => handle(url));
        Linking.getInitialURL()
            .then(handle)
            .catch(() => {});
        return () => sub.remove();
    }, [handle]);

    // Flush a pending launch once navigation is mounted and the user is signed in.
    useEffect(() => {
        if (pendingRef.current && isAuthenticated && navigationRef.current) {
            pendingRef.current = false;
            route();
        }
    }, [isAuthenticated, navigationRef, route]);
}
