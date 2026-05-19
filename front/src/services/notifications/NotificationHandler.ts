import * as Notifications from 'expo-notifications';
import { NavigationContainerRef } from '@react-navigation/native';
import { Platform } from 'react-native';
import { apiClient } from '../../apiClient';
import { getApiUrl } from '../../config';
import { handleDeepLink, type DeepLink } from './deepLinkRouter';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestPermissionAndRegister(): Promise<void> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const tokenData = await Notifications.getExpoPushTokenAsync();
  const deviceToken = tokenData.data;

  await apiClient.post(`${getApiUrl()}/devices`, {
    device_token: deviceToken,
    platform: Platform.OS,
  });
}

export async function deregisterDevice(): Promise<void> {
  const tokenData = await Notifications.getExpoPushTokenAsync().catch(() => null);
  if (!tokenData) return;
  await apiClient.delete(`${getApiUrl()}/devices/${encodeURIComponent(tokenData.data)}`);
}

export function setupNotificationHandlers(navigation: NavigationContainerRef<any>): () => void {
  const tapSub = Notifications.addNotificationResponseReceivedListener(response => {
    const deepLink = response.notification.request.content.data?.deep_link as DeepLink | undefined;
    handleDeepLink(deepLink ?? null, navigation);
  });

  return () => {
    tapSub.remove();
  };
}

export async function handleLastNotificationResponse(navigation: NavigationContainerRef<any>): Promise<void> {
  const lastResponse = await Notifications.getLastNotificationResponseAsync();
  if (lastResponse) {
    const deepLink = lastResponse.notification.request.content.data?.deep_link as DeepLink | undefined;
    handleDeepLink(deepLink ?? null, navigation);
  }
}
