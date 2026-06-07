import { NavigationContainerRef } from '@react-navigation/native';

export type DeepLink =
    | { screen: 'chat'; params: { chatId: string } }
    | { screen: 'planner'; params: { date: string } }
    | { screen: 'voice'; params: { chatId: string } };

export function handleDeepLink(
    link: DeepLink | null | undefined,
    navigation: NavigationContainerRef<any>,
): void {
    if (!link?.screen) return;

    switch (link.screen) {
        case 'chat':
            navigation.navigate('MainTabs', {
                screen: 'Chat',
                params: {
                    screen: 'ChatDetail',
                    params: { chatId: link.params.chatId },
                },
            });
            break;
        case 'planner':
            navigation.navigate('MainTabs', {
                screen: 'Planning',
            });
            break;
        case 'voice':
            navigation.navigate('MainTabs', {
                screen: 'Chat',
                params: {
                    screen: 'VoiceScreen',
                    params: { chatId: link.params.chatId },
                },
            });
            break;
    }
}
