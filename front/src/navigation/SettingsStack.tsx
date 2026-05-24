import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SettingsStackParamList } from './types';
import SettingsHomeScreen from '../screens/settings/screen';
import { ThemeScreen } from '../screens/settings/screens/ThemeScreen';
import { LocationScreen } from '../screens/settings/screens/LocationScreen';
import { BotIdentityScreen } from '../screens/settings/screens/BotIdentityScreen';
import { IntegrationsScreen } from '../screens/integrations/IntegrationsScreen';
import { MemoryScreen } from '../screens/settings/screens/MemoryScreen';

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export function SettingsStack() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="SettingsHome" component={SettingsHomeScreen} />
            <Stack.Screen name="ThemeScreen" component={ThemeScreen} />
            <Stack.Screen name="LocationScreen" component={LocationScreen} />
            <Stack.Screen
                name="BotIdentityScreen"
                component={BotIdentityScreen}
            />
            <Stack.Screen
                name="IntegrationsScreen"
                component={IntegrationsScreen}
            />
            <Stack.Screen name="MemoryScreen" component={MemoryScreen} />
        </Stack.Navigator>
    );
}
