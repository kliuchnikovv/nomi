import { useEffect, useCallback } from 'react';
import { Linking } from 'react-native';
import { useMain } from '../screens/main/context';

export function useShareExtension() {
    const { createNewChatWithMode } = useMain();

    const handle = useCallback((url: string) => {
        if (!url.startsWith('genie://share')) return;
        const match = url.match(/[?&]text=([^&]*)/);
        const text = match ? decodeURIComponent(match[1]) : '';
        if (text) createNewChatWithMode('agent', null, text);
    }, [createNewChatWithMode]);

    useEffect(() => {
        const sub = Linking.addEventListener('url', ({ url }) => handle(url));
        Linking.getInitialURL().then(url => { if (url) handle(url); }).catch(() => {});
        return () => sub.remove();
    }, [handle]);
}
