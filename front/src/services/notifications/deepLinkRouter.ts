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

    // The root navigator is the bottom Tab navigator (MainTabs is rendered
    // directly in AppNavigator, not registered as a named route), so we
    // navigate straight to the tab route — there is no 'MainTabs' route to
    // target.
    switch (link.screen) {
        case 'chat':
            navigation.navigate('Chat', {
                screen: 'ChatDetail',
                params: { chatId: link.params.chatId },
            });
            break;
        case 'planner':
            navigation.navigate('Planning');
            break;
        case 'voice':
            // Voice is now inline inside ChatDetail — open the chat and
            // request voice mode via `startVoice`.
            navigation.navigate('Chat', {
                screen: 'ChatDetail',
                params: { chatId: link.params.chatId, startVoice: true },
            });
            break;
    }
}
