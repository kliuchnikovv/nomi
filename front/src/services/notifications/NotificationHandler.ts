import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
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
  console.log('[Notifications] requestPermissionAndRegister called');
  const { status: existing } = await Notifications.getPermissionsAsync();
  console.log('[Notifications] current permission status:', existing);
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
    console.log('[Notifications] after request, status:', finalStatus);
  }

  if (finalStatus !== 'granted') {
    console.warn('[Notifications] Permission not granted, aborting token registration');
    return;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;
  console.log('[Notifications] projectId:', projectId);

  if (!projectId) {
    console.error('[Notifications] No Expo projectId found. Set expo.extra.eas.projectId in app.json.');
    return;
  }

  console.log('[Notifications] Calling getExpoPushTokenAsync...');
  let tokenData: { data: string };
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('getExpoPushTokenAsync timed out after 15s')), 15000)
    );
    tokenData = await Promise.race([
      Notifications.getExpoPushTokenAsync({ projectId }),
      timeout,
    ]) as { data: string };
    console.log('[Notifications] getExpoPushTokenAsync returned');
  } catch (e) {
    console.error('[Notifications] getExpoPushTokenAsync failed:', e);
    return;
  }
  const deviceToken = tokenData.data;
  console.log('[Notifications] Got push token:', deviceToken);

  try {
    await apiClient.post(`${getApiUrl()}/devices`, {
      device_token: deviceToken,
      platform: Platform.OS,
    });
    console.log('[Notifications] Device registered successfully');
  } catch (e) {
    console.error('[Notifications] Failed to register device token:', e);
  }
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
