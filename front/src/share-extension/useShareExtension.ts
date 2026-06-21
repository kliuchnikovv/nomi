import { useEffect, useCallback } from 'react';
import { Linking } from 'react-native';
import { useMain } from '../screens/main/context';
import { useChat } from '../screens/chat/context';

export function useShareExtension() {
    const { createNewChat } = useMain();
    const { sendMessage } = useChat();

    const handle = useCallback((url: string) => {
        if (!url.startsWith('nomi://share')) return;
        const match = url.match(/[?&]text=([^&]*)/);
        const text = match ? decodeURIComponent(match[1]) : '';
        if (text) {
            createNewChat();
            setTimeout(() => sendMessage(text), 500);
        }
    }, [createNewChat, sendMessage]);

    useEffect(() => {
        const sub = Linking.addEventListener('url', ({ url }) => handle(url));
        Linking.getInitialURL().then(url => { if (url) handle(url); }).catch(() => {});
        return () => sub.remove();
    }, [handle]);
}
