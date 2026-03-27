import React from 'react';
import { View, Modal } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../screens/auth/context';
import { AuthScreen } from '../screens/auth/screen';
import { MainTabs } from './MainTabs';
import { useMain } from '../screens/main/context';
import { getClientPlugin } from '../plugins/clientRegistry';
import { ChatProvider } from '../screens/chat/context';
import { emptyChatID } from '../screens/main/context';
import type { AuthStackParamList } from './types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();

function AuthStackNavigator() {
    return (
        <AuthStack.Navigator>
            <AuthStack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
        </AuthStack.Navigator>
    );
}

function PluginViewModal() {
    const { activePluginView, activePluginIntegrationId, setActivePluginView } = useMain();

    const PluginComponent = activePluginView ? getClientPlugin(activePluginView)?.MainComponent : null;

    if (!PluginComponent || !activePluginView) {
        return null;
    }

    return (
        <Modal
            visible={!!activePluginView}
            animationType="slide"
            onRequestClose={() => setActivePluginView(null)}
        >
            <ChatProvider
                activeChatID={emptyChatID}
                setActiveChatID={() => {}}
            >
                <View style={{ flex: 1 }}>
                    <PluginComponent
                        integrationId={activePluginIntegrationId ?? undefined}
                        onClose={() => setActivePluginView(null)}
                    />
                </View>
            </ChatProvider>
        </Modal>
    );
}

export function AppNavigator() {
    const { isAuthenticated } = useAuth();

    return (
        <>
            {isAuthenticated ? <MainTabs /> : <AuthStackNavigator />}
            <PluginViewModal />
        </>
    );
}
